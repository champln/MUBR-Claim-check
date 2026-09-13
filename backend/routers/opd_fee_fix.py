"""
API router: เติมยอดเบิกค่าบริการทั่วไป ผป.นอก — กัน C รหัส T33 / 45

แถว BillItems ของ "ค่าบริการทั่วไปผู้ป่วยนอก ในเวลาราชการ" (รหัสมาตรฐาน 55020)
ถูกส่งมาโดยมีจำนวนเงินที่เบิกได้ (ฟิลด์ 10) และจำนวนเงินที่ขอเบิก (ฟิลด์ 11)
เป็น 0.00 ทั้งที่มียอดรายการอยู่ -> เติมให้เท่ายอดรายการ แล้วเซ็น Checksum ใหม่

- POST /opd-fee-fix/preview : ดูว่าแถวไหนจะถูกเติม (ยังไม่แก้)
- POST /opd-fee-fix/apply   : แก้ + ดาวน์โหลดไฟล์ (ชื่อเดิม)
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
    OPD_SERVICE_FEE_CODE,
    apply_opd_fee_fix,
    build_zip_filename,
    preview_opd_fee_fix,
)

router = APIRouter(prefix="/opd-fee-fix", tags=["OPD Service Fee Fix (T33/45)"])


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


def _split_codes(text: Optional[str]) -> set:
    """รหัสรายการ — คั่นด้วย comma / เว้นวรรค / บรรทัดใหม่ (ว่าง = ใช้ค่า default)"""
    if not text or not text.strip():
        return {OPD_SERVICE_FEE_CODE}
    return {t.strip() for t in re.split(r"[\s,;]+", text) if t.strip()}


@router.post("/preview")
async def preview(
    files: List[UploadFile] = File(...),
    codes: Optional[str] = Form(None),
    amount: str = Form(""),
    current_user: User = Depends(get_current_user),
):
    contents = await _read_txt_uploads(files)
    try:
        result = preview_opd_fee_fix(contents, codes=_split_codes(codes), amount=amount)
    except ValueError as e:
        raise HTTPException(422, str(e))
    result["codes_used"] = sorted(_split_codes(codes))
    return result


@router.post("/apply")
async def apply(
    files: List[UploadFile] = File(...),
    codes: Optional[str] = Form(None),
    amount: str = Form(""),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    orig_zip_name = next(
        (f.filename.split("/")[-1].split("\\")[-1]
         for f in files if f.filename and f.filename.lower().endswith(".zip")),
        None,
    )
    contents = await _read_txt_uploads(files)
    try:
        result = apply_opd_fee_fix(contents, codes=_split_codes(codes), amount=amount)
    except ValueError as e:
        raise HTTPException(422, str(e))

    headers = {
        "X-Rows-Changed": str(result.rows_changed),
        "X-Fix-Changes": json.dumps(result.changes),
        "Access-Control-Expose-Headers": "X-Rows-Changed, X-Fix-Changes, X-Filename",
    }

    billtran_name = next((n for n in contents if "BILLTRAN" in n.upper()), None)
    if billtran_name and len(contents) == 1 and not orig_zip_name:
        headers["Content-Disposition"] = f"attachment; filename={billtran_name}"
        headers["X-Filename"] = billtran_name
        return StreamingResponse(
            io.BytesIO(result.files[billtran_name]),
            media_type="application/octet-stream", headers=headers,
        )

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in result.files.items():
            zf.writestr(name, data)
    zip_name = orig_zip_name or build_zip_filename(contents)
    headers["Content-Disposition"] = f"attachment; filename={zip_name}"
    headers["X-Filename"] = zip_name
    return StreamingResponse(io.BytesIO(buf.getvalue()), media_type="application/zip", headers=headers)
