"""
API router: เติมข้อมูลส่งเบิกประกันสังคม (รพ.หลักรามาธิบดี) — "SH 50"

แก้เฉพาะ BILLTRAN:
  1) HMain (field[14]) ว่าง -> รหัส รพ.หลัก (default 13781 = รามาธิบดี)
  2) แถวที่ส่วนต่าง Amount − ClaimAmt == 50 และยังไม่มีผู้ร่วมจ่าย
     -> OtherPayplan (field[17]) = SH, OtherPay (field[18]) = 50.00
แล้วเซ็น Checksum (MD5) ใหม่ ส่ง สปส. ได้ทันที

- POST /rama-sh50/preview : ดูว่าแต่ละแถวจะถูกเติมอะไร (ยังไม่แก้)
- POST /rama-sh50/apply   : แก้ + ดาวน์โหลดไฟล์ผลลัพธ์
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
    RAMA_HMAIN_DEFAULT,
    SH_AMOUNT_DEFAULT,
    apply_rama_sh50,
    build_zip_filename,
    preview_rama_sh50,
)

router = APIRouter(prefix="/rama-sh50", tags=["Rama SH50 Fix"])


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


def _split_invnos(text: Optional[str]) -> set:
    """แยก Inv.no ที่กรอกเอง — คั่นด้วย comma / เว้นวรรค / บรรทัดใหม่"""
    if not text:
        return set()
    return {t.strip() for t in re.split(r"[\s,;]+", text) if t.strip()}


@router.post("/preview")
async def preview(
    files: List[UploadFile] = File(...),
    hmain: str = Form(RAMA_HMAIN_DEFAULT),
    sh_amount: str = Form(SH_AMOUNT_DEFAULT),
    exclude_invnos: Optional[str] = Form(None),
    current_user: User = Depends(get_current_user),
):
    contents = await _read_txt_uploads(files)
    try:
        return preview_rama_sh50(
            contents, hmain=hmain, sh_amount=sh_amount,
            exclude_invnos=_split_invnos(exclude_invnos),
        )
    except ValueError as e:
        raise HTTPException(422, str(e))


@router.post("/apply")
async def apply(
    files: List[UploadFile] = File(...),
    hmain: str = Form(RAMA_HMAIN_DEFAULT),
    sh_amount: str = Form(SH_AMOUNT_DEFAULT),
    exclude_invnos: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # เก็บชื่อไฟล์ zip ต้นฉบับไว้ (เพื่อคืนไฟล์ชื่อเดิม — สปส. ต้องการ format ชื่อเดิม)
    orig_zip_name = next(
        (f.filename.split("/")[-1].split("\\")[-1]
         for f in files if f.filename and f.filename.lower().endswith(".zip")),
        None,
    )
    contents = await _read_txt_uploads(files)
    try:
        result = apply_rama_sh50(
            contents, hmain=hmain, sh_amount=sh_amount,
            exclude_invnos=_split_invnos(exclude_invnos),
        )
    except ValueError as e:
        raise HTTPException(422, str(e))

    billtran_name = next((n for n in contents if "BILLTRAN" in n.upper()), None)
    headers = {
        "X-Hmain-Filled": str(result.hmain_filled),
        "X-Sh-Set": str(result.sh_set),
        "X-Fix-Changes": json.dumps(result.changes),
        "Access-Control-Expose-Headers": "X-Hmain-Filled, X-Sh-Set, X-Fix-Changes, X-Filename",
    }

    # อัปโหลด .txt เดี่ยว (ไม่ใช่ zip) -> คืนไฟล์ชื่อเดิม
    if billtran_name and len(contents) == 1 and not orig_zip_name:
        headers["Content-Disposition"] = f"attachment; filename={billtran_name}"
        headers["X-Filename"] = billtran_name
        return StreamingResponse(
            io.BytesIO(result.files[billtran_name]),
            media_type="application/octet-stream",
            headers=headers,
        )

    # เป็นชุด (zip) -> คืน zip ชื่อเดิมของไฟล์ที่อัปโหลด
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in result.files.items():
            zf.writestr(name, data)
    zip_name = orig_zip_name or build_zip_filename(contents)
    headers["Content-Disposition"] = f"attachment; filename={zip_name}"
    headers["X-Filename"] = zip_name
    return StreamingResponse(io.BytesIO(buf.getvalue()), media_type="application/zip", headers=headers)
