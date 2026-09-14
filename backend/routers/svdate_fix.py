"""
API router: แก้วันที่ให้บริการใน BillItems — กัน C รหัส T42

T42 : SVDATE ไม่สัมพันธ์กับ BILLTRAN
วันที่ของแต่ละรายการใน BillItems (ฟิลด์ที่ 2) ต้องตรงกับวัน visit ใน BILLTRAN
(ฟิลด์ที่ 3) — แถวไหนไม่ตรงให้แก้ตามวัน visit แล้วเซ็น Checksum ใหม่

- POST /svdate-fix/preview : ดูว่าแถวไหนวันที่ไม่ตรง (ยังไม่แก้)
- POST /svdate-fix/apply   : แก้ + ดาวน์โหลดไฟล์ (ชื่อเดิม)
"""
import io
import json
import zipfile
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from models import User
from services.csop_file_editor import (
    apply_svdate_fix,
    build_zip_filename,
    preview_svdate_fix,
)

router = APIRouter(prefix="/svdate-fix", tags=["Service Date Fix (T42)"])


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


@router.post("/preview")
async def preview(
    files: List[UploadFile] = File(...),
    force_date: str = Form(""),
    current_user: User = Depends(get_current_user),
):
    contents = await _read_txt_uploads(files)
    try:
        return preview_svdate_fix(contents, force_date=force_date)
    except ValueError as e:
        raise HTTPException(422, str(e))


@router.post("/apply")
async def apply(
    files: List[UploadFile] = File(...),
    force_date: str = Form(""),
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
        result = apply_svdate_fix(contents, force_date=force_date)
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
