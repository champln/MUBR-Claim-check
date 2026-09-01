"""
API router: แก้ไฟล์ส่งเบิก CSOP กรณีระบุ AuthCode = 'COV-19' (การรักษาโควิด-19)

แก้เฉพาะ BILLTRAN field[1] (AuthCode) -> 'COV-19' สำหรับ visit ที่จับคู่ได้จาก
InvNo (field[4]) หรือ HN (field[6]) แล้วเซ็น Checksum (MD5) ใหม่ ส่ง สกส. ได้ทันที

เป้าหมายที่จะเติม COV-19 มาได้ 2 ทาง (ใช้พร้อมกันได้):
  1. ไฟล์รายชื่อ Excel (.xlsx/.xls) หรือ CSV ที่มีคอลัมน์ 'Inv no.' (หรือ HN)
  2. กรอก InvNo / HN เองในช่อง (คั่นด้วย , เว้นวรรค หรือขึ้นบรรทัดใหม่)

- POST /covid19-fix/preview : ดูว่าแถวไหนจะถูกแก้ (ยังไม่แก้จริง)
- POST /covid19-fix/apply   : แก้ + ดาวน์โหลดไฟล์ผลลัพธ์
"""
import io
import re
import zipfile
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from models import User
from services.csop_file_editor import (
    apply_covid19,
    build_zip_filename,
    preview_covid19,
)

router = APIRouter(prefix="/covid19-fix", tags=["COVID-19 Claim Fix"])

# ชื่อคอลัมน์ที่ยอมรับสำหรับ InvNo / HN (ทำเป็น lowercase + ตัดช่องว่าง/จุด เวลาเทียบ)
INVNO_HEADERS = {"invno", "invno.", "invoiceno", "invoicenumber", "inv"}
HN_HEADERS = {"hn", "hncode", "hosnum", "hospitalnumber"}


def _norm_header(h: str) -> str:
    return re.sub(r"[\s.\-_]+", "", (h or "").strip().lower())


def _split_manual(text: Optional[str]) -> set:
    """แยกค่าที่ผู้ใช้กรอกเอง — คั่นด้วย comma / เว้นวรรค / บรรทัดใหม่ / tab"""
    if not text:
        return set()
    return {t.strip() for t in re.split(r"[\s,;]+", text) if t.strip()}


def _parse_list_file(raw: bytes, filename: str) -> tuple[set, set]:
    """
    อ่านไฟล์รายชื่อ (.xlsx/.xls/.csv) -> (invno_set, hn_set)
    หาคอลัมน์ 'Inv no.' และ 'HN' แบบยืดหยุ่น (ไม่สนตัวพิมพ์/จุด/ช่องว่าง)
    """
    import pandas as pd

    name = (filename or "").lower()
    try:
        if name.endswith(".csv"):
            # ไฟล์ สกส./HOSxP ส่วนใหญ่เป็น cp874; fallback utf-8-sig
            try:
                df = pd.read_csv(io.BytesIO(raw), dtype=str, encoding="cp874")
            except Exception:
                df = pd.read_csv(io.BytesIO(raw), dtype=str, encoding="utf-8-sig")
        else:
            df = pd.read_excel(io.BytesIO(raw), dtype=str)
    except Exception as e:
        raise HTTPException(422, f"อ่านไฟล์รายชื่อไม่สำเร็จ: {e}")

    header_map = {_norm_header(c): c for c in df.columns}
    invno_col = next((header_map[h] for h in INVNO_HEADERS if h in header_map), None)
    hn_col = next((header_map[h] for h in HN_HEADERS if h in header_map), None)
    if not invno_col and not hn_col:
        raise HTTPException(
            422,
            "ไม่พบคอลัมน์ 'Inv no.' หรือ 'HN' ในไฟล์รายชื่อ — "
            f"คอลัมน์ที่พบ: {', '.join(map(str, df.columns))}",
        )

    invno_set: set = set()
    hn_set: set = set()
    if invno_col:
        invno_set = {str(v).strip() for v in df[invno_col].dropna() if str(v).strip()}
    if hn_col:
        hn_set = {str(v).strip() for v in df[hn_col].dropna() if str(v).strip()}
    return invno_set, hn_set


async def _read_txt_uploads(files: List[UploadFile]) -> Dict[str, bytes]:
    """อ่านไฟล์ .txt/.zip -> {basename: bytes} (เฉพาะ .txt; แตก zip อัตโนมัติ)"""
    contents: Dict[str, bytes] = {}
    for upload in files:
        fname = upload.filename or "unknown"
        raw = await upload.read()
        if fname.lower().endswith(".zip"):
            try:
                with zipfile.ZipFile(io.BytesIO(raw)) as zf:
                    for zname in zf.namelist():
                        base = zname.split("/")[-1].split("\\")[-1]
                        if base and base.lower().endswith(".txt"):
                            contents[base] = zf.read(zname)
            except Exception as e:
                raise HTTPException(400, f"ไม่สามารถแตกไฟล์ ZIP ได้: {e}")
        else:
            base = fname.split("/")[-1].split("\\")[-1]
            contents[base] = raw
    if not contents:
        raise HTTPException(400, "ไม่พบไฟล์ .txt ที่ประมวลผลได้")
    return contents


async def _collect_targets(
    list_file: Optional[UploadFile],
    manual_invnos: Optional[str],
    manual_hns: Optional[str],
) -> tuple[set, set]:
    """รวมเป้าหมายจากไฟล์รายชื่อ + ช่องกรอกเอง -> (invno_set, hn_set)"""
    invno_set = _split_manual(manual_invnos)
    hn_set = _split_manual(manual_hns)
    if list_file is not None:
        raw = await list_file.read()
        if raw:
            f_inv, f_hn = _parse_list_file(raw, list_file.filename or "")
            invno_set |= f_inv
            hn_set |= f_hn
    return invno_set, hn_set


def _is_true(v: Optional[str]) -> bool:
    return str(v or "").strip().lower() in ("1", "true", "yes", "on")


@router.post("/preview")
async def preview(
    files: List[UploadFile] = File(...),
    list_file: Optional[UploadFile] = File(None),
    manual_invnos: Optional[str] = Form(None),
    manual_hns: Optional[str] = Form(None),
    apply_all: Optional[str] = Form(None),
    current_user: User = Depends(get_current_user),
):
    contents = await _read_txt_uploads(files)
    all_mode = _is_true(apply_all)
    invno_set, hn_set = await _collect_targets(list_file, manual_invnos, manual_hns)
    if not all_mode and not invno_set and not hn_set:
        raise HTTPException(400, "ต้องระบุเป้าหมาย: อัปโหลดไฟล์รายชื่อ กรอก InvNo/HN หรือเลือกเติมทุก VN")
    try:
        result = preview_covid19(contents, invno_set, hn_set, apply_all=all_mode)
    except ValueError as e:
        raise HTTPException(422, str(e))
    result["target_invno_count"] = len(invno_set)
    result["target_hn_count"] = len(hn_set)
    result["apply_all"] = all_mode
    return result


@router.post("/apply")
async def apply(
    files: List[UploadFile] = File(...),
    list_file: Optional[UploadFile] = File(None),
    manual_invnos: Optional[str] = Form(None),
    manual_hns: Optional[str] = Form(None),
    apply_all: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    contents = await _read_txt_uploads(files)
    all_mode = _is_true(apply_all)
    invno_set, hn_set = await _collect_targets(list_file, manual_invnos, manual_hns)
    if not all_mode and not invno_set and not hn_set:
        raise HTTPException(400, "ต้องระบุเป้าหมาย: อัปโหลดไฟล์รายชื่อ กรอก InvNo/HN หรือเลือกเติมทุก VN")

    try:
        result = apply_covid19(contents, invno_set, hn_set, apply_all=all_mode)
    except ValueError as e:
        raise HTTPException(422, str(e))

    billtran_name = next((n for n in contents if "BILLTRAN" in n.upper()), None)

    # ถ้ามีไฟล์เดียว (BILLTRAN) ส่งเป็น .txt; หลายไฟล์ส่งเป็น zip
    changed_files = {n: b for n, b in result.files.items()}
    import json
    headers = {
        "X-Fix-Changed": str(result.changed),
        "X-Fix-Changes": json.dumps(result.changes),
        "Access-Control-Expose-Headers": "X-Fix-Changed, X-Fix-Changes, X-Filename",
    }
    if billtran_name and len(contents) == 1:
        out_name = billtran_name.replace(".txt", "_COV19.txt")
        headers["Content-Disposition"] = f"attachment; filename={out_name}"
        headers["X-Filename"] = out_name
        # octet-stream: ส่ง byte ดิบ (windows-874) โดยไม่ให้ browser ตีความ charset
        return StreamingResponse(
            io.BytesIO(changed_files[billtran_name]),
            media_type="application/octet-stream",
            headers=headers,
        )

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in changed_files.items():
            zf.writestr(name, data)
    zip_name = build_zip_filename(contents).replace(".zip", "_COV19.zip")
    headers["Content-Disposition"] = f"attachment; filename={zip_name}"
    headers["X-Filename"] = zip_name
    return StreamingResponse(io.BytesIO(buf.getvalue()), media_type="application/zip", headers=headers)
