"""
API router: แก้วันที่ปรับปรุงล่าสุด (DateRev) ในไฟล์ผู้ป่วยใน CIPN/AIPN

อาการที่พบ: รายการค่ารักษาที่ยังไม่เคยตั้งวันที่ปรับปรุงใน HOSxP จะถูก export
ออกมาเป็น "วันที่ส่งออกไฟล์" แทนวันที่จริง (เช่น ควรเป็น 2005-02-10 แต่ได้ 2026-09-24)

- POST /cipn-daterev/preview : ดูรายการและ DateRev ปัจจุบัน + ชี้แถวที่น่าสงสัย
- POST /cipn-daterev/apply   : แก้ตามรหัสรายการ + เซ็นลายเซ็นใหม่ แล้วดาวน์โหลด
  (ต้องตั้งค่าคีย์ HMAC ของโรงพยาบาลก่อน ไม่งั้นระบบจะไม่ยอมเซ็น)
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
from services.aipn_signer import config_summary
from services.cipn_file_editor import apply_daterev, is_cipn, preview_daterev

router = APIRouter(prefix="/cipn-daterev", tags=["CIPN DateRev Fix"])


async def _read_cipn_upload(files: List[UploadFile]) -> tuple:
    """คืน (ชื่อไฟล์, ไบต์) ของไฟล์ CIPN/AIPN ไฟล์แรกที่เจอ (รองรับ .zip ด้วย)"""
    for upload in files:
        fname = (upload.filename or "unknown").split("/")[-1].split("\\")[-1]
        raw = await upload.read()
        if fname.lower().endswith(".zip"):
            try:
                with zipfile.ZipFile(io.BytesIO(raw)) as zf:
                    for zname in zf.namelist():
                        base = zname.split("/")[-1].split("\\")[-1]
                        data = zf.read(zname)
                        if base.lower().endswith(".xml") and is_cipn(data):
                            return base, data
            except Exception as e:
                raise HTTPException(400, f"ไม่สามารถแตกไฟล์ ZIP ได้: {e}")
        elif is_cipn(raw):
            return fname, raw
    raise HTTPException(400, "ไม่พบไฟล์ผู้ป่วยใน (CIPN/AIPN) ในสิ่งที่อัปโหลด")


def _parse_rules(rules: Optional[str]) -> Dict[str, str]:
    if not rules:
        return {}
    try:
        data = json.loads(rules)
    except Exception as e:
        raise HTTPException(400, f"rules ไม่ถูกต้อง: {e}")
    if not isinstance(data, dict):
        raise HTTPException(400, "rules ต้องเป็น object {รหัสรายการ: วันที่}")
    return {str(k).strip(): str(v).strip() for k, v in data.items() if str(k).strip()}


@router.post("/preview")
async def preview(
    files: List[UploadFile] = File(...),
    rules: Optional[str] = Form(None),
    current_user: User = Depends(get_current_user),
):
    name, raw = await _read_cipn_upload(files)
    try:
        result = preview_daterev(raw, _parse_rules(rules))
    except ValueError as e:
        raise HTTPException(422, str(e))
    cfg = config_summary()
    result["file"] = name
    result["has_key"] = cfg["has_key"]
    result["can_sign"] = True
    result["sign_note"] = (
        "เซ็นใหม่ด้วย HMAC + คีย์ของโรงพยาบาล"
        if cfg["has_key"] else
        "ยังไม่ได้ตั้งค่าคีย์ของโรงพยาบาล — จะเซ็นใหม่ด้วย MD5 ของเนื้อไฟล์ "
        "(ค่าที่ได้ไม่ตรงกับลายเซ็นเดิมที่โปรแกรม สกส. สร้าง)"
    )
    return result


@router.post("/apply")
async def apply(
    files: List[UploadFile] = File(...),
    rules: Optional[str] = Form(None),
    sign_mode: str = Form(""),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    name, raw = await _read_cipn_upload(files)
    try:
        out = apply_daterev(raw, _parse_rules(rules), sign_mode=sign_mode)
    except ValueError as e:
        raise HTTPException(422, str(e))

    headers = {
        "X-Sign-Mode": sign_mode or "hmac",
        "Content-Disposition": f"attachment; filename={name}",
        "X-Filename": name,
        "Access-Control-Expose-Headers": "X-Filename, X-Sign-Mode",
    }
    return StreamingResponse(io.BytesIO(out), media_type="application/xml", headers=headers)
