"""
API router: แก้เหตุผลการใช้ยา (ClaimCont) ในแฟ้ม BILLDISP — กัน C รหัส G04

G04 : ระบุ claim control เป็น EF (ไม่เบิก) แต่มีการเบิกค่ายา
วิธีแก้: เปลี่ยนเหตุผลเป็นค่าที่แพทย์สรุป (ส่วนใหญ่ EE) ใน DispensedItems ฟิลด์ที่ 16

- POST /claimcont-fix/preview : ดูแถวที่เป็น EF / E (ยังไม่แก้)
- POST /claimcont-fix/apply   : แก้แถวที่เลือก + เซ็น Checksum ใหม่ + ดาวน์โหลด (ชื่อเดิม)
"""
import io
import json
import zipfile
from typing import Dict, List

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from auth import get_current_user
from models import User
from routers.stdcode_fix import _read_txt_uploads
from services.csop_file_editor import (
    apply_claimcont_fix,
    build_zip_filename,
    preview_claimcont_fix,
)

router = APIRouter(prefix="/claimcont-fix", tags=["BILLDISP ClaimCont Fix (G04)"])


def _selections(raw: str) -> Dict[int, str]:
    """JSON {"<ลำดับแถว DispensedItems>": "EE"}"""
    try:
        data = json.loads(raw or "{}")
        return {int(k): str(v) for k, v in data.items()}
    except Exception as e:
        raise HTTPException(400, f"selections ไม่ถูกต้อง: {e}")


@router.post("/preview")
async def preview(
    files: List[UploadFile] = File(...),
    current_user: User = Depends(get_current_user),
):
    contents = await _read_txt_uploads(files)
    try:
        return preview_claimcont_fix(contents)
    except ValueError as e:
        raise HTTPException(422, str(e))


@router.post("/apply")
async def apply(
    files: List[UploadFile] = File(...),
    selections: str = Form(...),
    current_user: User = Depends(get_current_user),
):
    orig_zip_name = next(
        (f.filename.split("/")[-1].split("\\")[-1]
         for f in files if f.filename and f.filename.lower().endswith(".zip")),
        None,
    )
    contents = await _read_txt_uploads(files)
    try:
        result = apply_claimcont_fix(contents, _selections(selections))
    except ValueError as e:
        raise HTTPException(422, str(e))

    headers = {
        "X-ClaimCont-Changed": str(result.filled),
        "X-ClaimCont-Left": str(result.unresolved),
        "X-Fix-Changes": json.dumps(result.changes, ensure_ascii=True),
        "Access-Control-Expose-Headers": "X-ClaimCont-Changed, X-ClaimCont-Left, X-Fix-Changes, X-Filename",
    }

    disp_name = next((n for n in contents if "BILLDISP" in n.upper()), None)
    # อัปโหลดไฟล์ .txt เดี่ยว -> คืนไฟล์ชื่อเดิม
    if disp_name and len(contents) == 1 and not orig_zip_name:
        headers["Content-Disposition"] = f"attachment; filename={disp_name}"
        headers["X-Filename"] = disp_name
        return StreamingResponse(
            io.BytesIO(result.files[disp_name]),
            media_type="application/octet-stream", headers=headers,
        )

    # เป็นชุด -> zip ชื่อเดิม (ไฟล์อื่นในชุดคงเดิมทุกไบต์)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in result.files.items():
            zf.writestr(name, data)
    zip_name = orig_zip_name or build_zip_filename(contents)
    headers["Content-Disposition"] = f"attachment; filename={zip_name}"
    headers["X-Filename"] = zip_name
    return StreamingResponse(io.BytesIO(buf.getvalue()), media_type="application/zip", headers=headers)
