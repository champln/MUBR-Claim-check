"""
API router: ตรวจและแก้ไฟล์ผู้ป่วยใน CIPN/AIPN ตามสเปก สกส.

เน้นการแก้ ClaimCat ให้ตรงเงื่อนไขการเบิก แล้วคำนวณ DRGCharge / XDRGClaim
และค่า HMAC ใหม่ให้ครบในครั้งเดียว (5 อย่างนี้ต้องเปลี่ยนพร้อมกัน ไม่งั้นถูกตีกลับ)

- POST /cipn-fix/validate : ตรวจไฟล์ (ไม่แก้)
- POST /cipn-fix/apply    : แก้ ClaimCat ตามที่เลือก + คำนวณใหม่ + ดาวน์โหลด
"""
import io
import json
import zipfile
from datetime import datetime
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from models import User, UserAuditLog
from services.cipn_file_editor import is_cipn
from services.cipn_validator import finalize, output_filename, set_claim_cat, validate

router = APIRouter(prefix="/cipn-fix", tags=["CIPN Validate & Fix"])


async def _read_one(files: List[UploadFile]) -> tuple:
    for upload in files:
        fname = (upload.filename or "unknown").split("/")[-1].split("\\")[-1]
        raw = await upload.read()
        if fname.lower().endswith(".zip"):
            try:
                with zipfile.ZipFile(io.BytesIO(raw)) as zf:
                    for zname in zf.namelist():
                        data = zf.read(zname)
                        base = zname.split("/")[-1].split("\\")[-1]
                        if base.lower().endswith(".xml") and is_cipn(data):
                            return base, data
            except Exception as e:
                raise HTTPException(400, f"ไม่สามารถแตกไฟล์ ZIP ได้: {e}")
        elif is_cipn(raw):
            return fname, raw
    raise HTTPException(400, "ไม่พบไฟล์ผู้ป่วยใน (CIPN/AIPN) ในสิ่งที่อัปโหลด")


@router.post("/validate")
async def validate_file(
    files: List[UploadFile] = File(...),
    current_user: User = Depends(get_current_user),
):
    name, raw = await _read_one(files)
    result = validate(raw)
    result["file"] = name
    return result


@router.post("/apply")
async def apply_fix(
    files: List[UploadFile] = File(...),
    changes: Optional[str] = Form(None),
    update_effective_time: bool = Form(True),
    rename_output: bool = Form(True),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    name, raw = await _read_one(files)

    parsed: List[dict] = []
    if changes:
        try:
            data = json.loads(changes)
        except Exception as e:
            raise HTTPException(400, f"changes ไม่ถูกต้อง: {e}")
        if not isinstance(data, list):
            raise HTTPException(400, "changes ต้องเป็น list ของ {seq, claim_cat, claim_up}")
        parsed = data

    before = validate(raw)
    out, applied = raw, []
    if parsed:
        try:
            out, applied = set_claim_cat(raw, parsed)
        except ValueError as e:
            raise HTTPException(422, str(e))
    elif before["error_count"] == 0:
        raise HTTPException(422, "ไฟล์นี้ตรวจแล้วไม่พบข้อผิดพลาด และยังไม่ได้เลือกแถวที่จะแก้")

    now = datetime.now()
    out = finalize(out, now.strftime("%Y-%m-%dT00:00:00") if update_effective_time else "")
    after = validate(out)

    # บันทึกว่าใครแก้อะไร (ไม่เก็บบรรทัดที่มีข้อมูลผู้ป่วย)
    db.add(UserAuditLog(
        actor_user_id=current_user.id,
        action="CIPN_FIX",
        detail=json.dumps({
            "file": name,
            "changes": [{"seq": a["seq"], "before": a["before"], "after": a["after"]} for a in applied],
            "totals_before": before["totals"],
            "totals_after": after["totals"],
        }, ensure_ascii=False),
    ))
    db.commit()

    out_name = output_filename(out, now.strftime("%Y%m%d%H%M%S")) if rename_output else name
    headers = {
        "Content-Disposition": f"attachment; filename={out_name}",
        "X-Filename": out_name,
        # HTTP header ส่งได้เฉพาะ latin-1 — ชื่อรายการเป็นภาษาไทยจึงต้อง escape
        # (ฝั่งหน้าเว็บ JSON.parse คืนข้อความไทยกลับมาเหมือนเดิม)
        "X-Changes": json.dumps(applied, ensure_ascii=True),
        "X-Totals-After": json.dumps(after["totals"], ensure_ascii=True),
        "X-Errors-After": str(after["error_count"]),
        "Access-Control-Expose-Headers": "X-Filename, X-Changes, X-Totals-After, X-Errors-After",
    }
    return StreamingResponse(io.BytesIO(out), media_type="application/xml", headers=headers)
