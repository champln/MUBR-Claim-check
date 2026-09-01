"""
API router: แก้ไขรหัส TMT ยาในไฟล์ส่งเบิก (BillItems + DispensedItems)

แทนที่รหัส TMT เก่า -> ใหม่ ให้ตรงกันทั้งใน BILLTRAN (BillItems) และ
BILLDISP (DispensedItems) แล้วเซ็น Checksum ใหม่ทั้ง 2 ไฟล์

จับคู่ยาได้ 2 แบบ (ต่อ 1 กฎ): รหัส TMT เดิม  หรือ  Hosdrugcode
รับกฎได้ 2 ทาง: กรอกเอง (JSON) หรือไฟล์ Excel/CSV

- POST /tmt-fix/preview : ดูว่ารายการไหนจะถูกแก้ (ยังไม่แก้)
- POST /tmt-fix/apply   : แก้ + ดาวน์โหลด zip
"""
import io
import json
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
    TmtRule,
    apply_tmt_fix,
    build_zip_filename,
    preview_tmt_fix,
)

router = APIRouter(prefix="/tmt-fix", tags=["TMT Code Fix"])

# ชื่อคอลัมน์ที่ยอมรับในไฟล์ Excel/CSV (normalize: ตัดช่องว่าง/จุด/ขีด + lowercase)
NEW_TMT_HEADERS = {"newtmt", "tmtnew", "tmtใหม่", "รหัสใหม่", "tmtidใหม่", "รหัสtmtใหม่"}
OLD_TMT_HEADERS = {"oldtmt", "tmtold", "tmtเดิม", "tmtเก่า", "รหัสเดิม", "รหัสเก่า", "tmtidเดิม", "รหัสtmtเดิม"}
HOSCODE_HEADERS = {"hosdrugcode", "hoscode", "workingcode", "รหัสรพ", "รหัสยารพ", "hospitaldrugcode"}


def _norm_header(h: str) -> str:
    return re.sub(r"[\s.\-_/]+", "", str(h or "").strip().lower())


async def _read_txt_uploads(files: List[UploadFile]) -> Dict[str, bytes]:
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


def _parse_rule_file(raw: bytes, filename: str) -> List[TmtRule]:
    """อ่านไฟล์กฎ (.xlsx/.xls/.csv) -> รายการ TmtRule (new_tmt + old_tmt/hosdrugcode)"""
    import pandas as pd

    name = (filename or "").lower()
    try:
        if name.endswith(".csv"):
            try:
                df = pd.read_csv(io.BytesIO(raw), dtype=str, encoding="cp874")
            except Exception:
                df = pd.read_csv(io.BytesIO(raw), dtype=str, encoding="utf-8-sig")
        else:
            df = pd.read_excel(io.BytesIO(raw), dtype=str)
    except Exception as e:
        raise HTTPException(422, f"อ่านไฟล์กฎไม่สำเร็จ: {e}")

    hmap = {_norm_header(c): c for c in df.columns}
    new_col = next((hmap[h] for h in NEW_TMT_HEADERS if h in hmap), None)
    old_col = next((hmap[h] for h in OLD_TMT_HEADERS if h in hmap), None)
    hos_col = next((hmap[h] for h in HOSCODE_HEADERS if h in hmap), None)
    if not new_col or (not old_col and not hos_col):
        raise HTTPException(
            422,
            "ไฟล์กฎต้องมีคอลัมน์ 'TMT ใหม่' และ ('TMT เดิม' หรือ 'Hosdrugcode') — "
            f"คอลัมน์ที่พบ: {', '.join(map(str, df.columns))}",
        )

    rules: List[TmtRule] = []
    for _, r in df.iterrows():
        new_tmt = str(r[new_col]).strip() if new_col and str(r[new_col]).strip() not in ("", "nan") else ""
        old_tmt = str(r[old_col]).strip() if old_col and str(r[old_col]).strip() not in ("", "nan") else ""
        hos = str(r[hos_col]).strip() if hos_col and str(r[hos_col]).strip() not in ("", "nan") else ""
        if new_tmt and (old_tmt or hos):
            rules.append(TmtRule(new_tmt=new_tmt, old_tmt=old_tmt, hosdrugcode=hos))
    return rules


def _collect_rules(rules_json: Optional[str], rule_file_rules: List[TmtRule]) -> List[TmtRule]:
    rules: List[TmtRule] = list(rule_file_rules)
    if rules_json:
        try:
            data = json.loads(rules_json)
        except Exception as e:
            raise HTTPException(400, f"rules ไม่ถูกต้อง: {e}")
        for item in data if isinstance(data, list) else []:
            new_tmt = str(item.get("new_tmt", "")).strip()
            old_tmt = str(item.get("old_tmt", "")).strip()
            hos = str(item.get("hosdrugcode", "")).strip()
            if new_tmt and (old_tmt or hos):
                rules.append(TmtRule(new_tmt=new_tmt, old_tmt=old_tmt, hosdrugcode=hos))
    return rules


async def _gather(files, rules_json, list_file):
    contents = await _read_txt_uploads(files)
    file_rules: List[TmtRule] = []
    if list_file is not None:
        raw = await list_file.read()
        if raw:
            file_rules = _parse_rule_file(raw, list_file.filename or "")
    rules = _collect_rules(rules_json, file_rules)
    if not rules:
        raise HTTPException(400, "ต้องระบุกฎแก้ TMT: กรอกเอง หรืออัปโหลดไฟล์ Excel/CSV")
    return contents, rules


@router.post("/preview")
async def preview(
    files: List[UploadFile] = File(...),
    rules: Optional[str] = Form(None),
    list_file: Optional[UploadFile] = File(None),
    current_user: User = Depends(get_current_user),
):
    contents, rule_list = await _gather(files, rules, list_file)
    try:
        result = preview_tmt_fix(contents, rule_list)
    except ValueError as e:
        raise HTTPException(422, str(e))
    result["rule_count"] = len(rule_list)
    return result


@router.post("/apply")
async def apply(
    files: List[UploadFile] = File(...),
    rules: Optional[str] = Form(None),
    list_file: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    contents, rule_list = await _gather(files, rules, list_file)
    try:
        result = apply_tmt_fix(contents, rule_list)
    except ValueError as e:
        raise HTTPException(422, str(e))

    headers = {
        "X-Billitems-Changed": str(result.billitems_changed),
        "X-Dispitems-Changed": str(result.dispitems_changed),
        "X-Fix-Changes": json.dumps(result.changes),
        "Access-Control-Expose-Headers": "X-Billitems-Changed, X-Dispitems-Changed, X-Fix-Changes, X-Filename",
    }

    billtran_name = next((n for n in contents if "BILLTRAN" in n.upper()), None)
    if billtran_name and len(contents) == 1:
        out_name = billtran_name.replace(".txt", "_TMT.txt")
        headers["Content-Disposition"] = f"attachment; filename={out_name}"
        headers["X-Filename"] = out_name
        return StreamingResponse(io.BytesIO(result.files[billtran_name]),
                                 media_type="application/octet-stream", headers=headers)

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in result.files.items():
            zf.writestr(name, data)
    zip_name = build_zip_filename(contents).replace(".zip", "_TMT.zip")
    headers["Content-Disposition"] = f"attachment; filename={zip_name}"
    headers["X-Filename"] = zip_name
    return StreamingResponse(io.BytesIO(buf.getvalue()), media_type="application/zip", headers=headers)
