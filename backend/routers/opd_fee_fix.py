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
    apply_total_sync,
    build_zip_filename,
    preview_opd_fee_fix,
    preview_total_sync,
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

    # ยอดหัวบิลไม่ตรงผลรวมรายการ (A04/T33/T45) — ดูจากไฟล์ "หลังเติมยอดแล้ว"
    try:
        filled = apply_opd_fee_fix(contents, codes=_split_codes(codes), amount=amount).files
    except ValueError:
        filled = contents
    try:
        result["totals"] = preview_total_sync(filled)
    except ValueError as e:
        result["totals"] = {"billtran_file": None, "total_change_count": 0, "rows": [], "error": str(e)}
    return result


@router.post("/apply")
async def apply(
    files: List[UploadFile] = File(...),
    codes: Optional[str] = Form(None),
    amount: str = Form(""),
    fill_fee: bool = Form(True),
    sync_totals: bool = Form(True),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    orig_zip_name = next(
        (f.filename.split("/")[-1].split("\\")[-1]
         for f in files if f.filename and f.filename.lower().endswith(".zip")),
        None,
    )
    contents = await _read_txt_uploads(files)
    if not fill_fee and not sync_totals:
        raise HTTPException(400, "ต้องเลือกอย่างน้อย 1 อย่าง: เติมยอดเบิก หรือ ปรับยอดหัวบิล")

    working = contents
    changes: List[str] = []
    fee_rows = total_rows = 0
    errors: List[str] = []

    # 1) เติมยอดเบิกของรายการค่าบริการ (T33/45)
    if fill_fee:
        try:
            r = apply_opd_fee_fix(working, codes=_split_codes(codes), amount=amount)
            working, fee_rows = r.files, r.rows_changed
            changes += r.changes
        except ValueError as e:
            errors.append(str(e))

    # 2) ปรับยอดหัวบิลให้ตรงผลรวมรายการ (A04/T33/T45) — ต้องทำหลังข้อ 1 เสมอ
    if sync_totals:
        try:
            r = apply_total_sync(working)
            working, total_rows = r.files, r.rows_changed
            changes += r.changes
        except ValueError as e:
            errors.append(str(e))

    if fee_rows == 0 and total_rows == 0:
        raise HTTPException(422, " · ".join(errors) or "ไม่พบแถวที่ต้องแก้")

    class _R:
        files = working
    result = _R()

    headers = {
        "X-Rows-Changed": str(fee_rows + total_rows),
        "X-Fee-Rows": str(fee_rows),
        "X-Total-Rows": str(total_rows),
        "X-Fix-Changes": json.dumps(changes),
        "Access-Control-Expose-Headers": "X-Rows-Changed, X-Fee-Rows, X-Total-Rows, X-Fix-Changes, X-Filename",
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
