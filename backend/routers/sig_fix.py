"""
API router: เติมวิธีการใช้ยาในแฟ้ม BILLDISP — กัน C รหัส R24 (ขาดวิธีการใช้ยา)

ยา (DispensedItems PrdCat = 1) ที่ข้อความวิธีใช้ (sigText) ว่าง แม้แพทย์ระบุวิธีใช้แล้ว
เพราะรหัสวิธีใช้นั้นใน HOSxP ไม่มีข้อความผูกไว้ ระบบเติมข้อความจาก:
  1) คลังวิธีใช้ตามรหัสวิธีใช้ (sigCode)
  2) คลังวิธีใช้ตามรหัสยา (HospDrgID) — กรณีไม่มีรหัสวิธีใช้
  3) ข้อความที่ผู้ใช้กรอกในหน้าเว็บ (ใช้ครั้งนี้ หรือบันทึกเข้าคลัง)
ระบบไม่แต่งวิธีใช้ยาขึ้นเอง

อีกกรณีที่ติด R24 ซ้ำ: ข้อความวิธีใช้ที่หมอพิมพ์มีอักขระ & < > (สกส. อ่านเป็น XML)
ระบบเสนอข้อความที่แทนอักขระเป็นคำ ผู้ใช้แก้รายแถวได้ (row_overrides)

- GET/POST/DELETE /sig-fix/library : จัดการคลังวิธีใช้
- POST /sig-fix/preview            : ดูว่ายาตัวไหนขาดวิธีใช้ / วิธีใช้มี & < > (ยังไม่แก้)
- POST /sig-fix/apply              : เติม + เซ็น Checksum ใหม่ + ดาวน์โหลด (ชื่อเดิม)
"""
import io
import json
import zipfile
from typing import Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from models import SigTextMapping, User
from routers.stdcode_fix import _read_txt_uploads
from services.csop_file_editor import (
    apply_sig_fix,
    build_zip_filename,
    clean_sig_text,
    preview_sig_fix,
)

router = APIRouter(prefix="/sig-fix", tags=["BILLDISP sigText Fix (R24)"])

KEY_TYPES = ("SIG", "DRUG")


# ─── คลังวิธีใช้ ─────────────────────────────────────────────────────────────

class MappingIn(BaseModel):
    key_type: str = "SIG"
    key: str
    sig_text: str
    description: Optional[str] = None


def _load_library(db: Session) -> Tuple[Dict[str, str], Dict[str, str]]:
    by_sig: Dict[str, str] = {}
    by_drug: Dict[str, str] = {}
    for m in db.query(SigTextMapping).all():
        (by_sig if m.key_type == "SIG" else by_drug)[m.key] = m.sig_text
    return by_sig, by_drug


def _upsert(db: Session, key_type: str, key: str, text: str, desc: Optional[str], user_id: int) -> None:
    row = db.query(SigTextMapping).filter(
        SigTextMapping.key_type == key_type, SigTextMapping.key == key).first()
    if row is None:
        row = SigTextMapping(key_type=key_type, key=key)
        db.add(row)
    row.sig_text = text
    if desc is not None:
        row.description = desc.strip()[:255]
    row.updated_by_id = user_id


@router.get("/library")
def list_library(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = db.query(SigTextMapping).order_by(SigTextMapping.key_type, SigTextMapping.key).all()
    return [
        {
            "id": m.id, "key_type": m.key_type, "key": m.key, "sig_text": m.sig_text,
            "description": m.description or "",
            "updated_at": (m.updated_at or m.created_at).isoformat() if (m.updated_at or m.created_at) else None,
        }
        for m in rows
    ]


@router.post("/library")
def upsert_library(
    items: List[MappingIn],
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """เพิ่ม/แก้วิธีใช้ในคลัง (key_type+key ซ้ำ = ทับของเดิม)"""
    saved = 0
    for item in items:
        key_type = (item.key_type or "SIG").strip().upper()
        key = (item.key or "").strip()
        if key_type not in KEY_TYPES:
            raise HTTPException(400, f"key_type ต้องเป็น {' / '.join(KEY_TYPES)}")
        try:
            text = clean_sig_text(item.sig_text)
        except ValueError as e:
            raise HTTPException(400, str(e))
        if not key or not text:
            continue
        _upsert(db, key_type, key, text, item.description, current_user.id)
        saved += 1
    db.commit()
    return {"saved": saved, "total": db.query(SigTextMapping).count()}


@router.delete("/library/{mapping_id}")
def delete_library(
    mapping_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    row = db.query(SigTextMapping).filter(SigTextMapping.id == mapping_id).first()
    if row is None:
        raise HTTPException(404, "ไม่พบรายการที่ต้องการลบ")
    db.delete(row)
    db.commit()
    return {"deleted": mapping_id}


# ─── ตรวจ/แก้ไฟล์ ────────────────────────────────────────────────────────────

def _overrides(raw: Optional[str]) -> List[dict]:
    """
    วิธีใช้ที่ผู้ใช้กรอกสดในหน้าเว็บ (JSON list):
      [{"key_type": "SIG"|"DRUG", "key": "...", "sig_text": "...", "description": "..."}]
    """
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except Exception as e:
        raise HTTPException(400, f"overrides ไม่ถูกต้อง: {e}")
    if not isinstance(data, list):
        raise HTTPException(400, "overrides ต้องเป็น list")
    out = []
    for d in data:
        if not isinstance(d, dict):
            continue
        key_type = str(d.get("key_type") or "SIG").strip().upper()
        key = str(d.get("key") or "").strip()
        try:
            text = clean_sig_text(str(d.get("sig_text") or ""))
        except ValueError as e:
            raise HTTPException(400, str(e))
        if key_type in KEY_TYPES and key and text:
            out.append({"key_type": key_type, "key": key, "sig_text": text,
                        "description": d.get("description")})
    return out


def _row_overrides(raw: Optional[str]) -> Dict[int, str]:
    """ข้อความที่ผู้ใช้แก้เองรายแถว (JSON: {"<ลำดับแถว DispensedItems>": "ข้อความ"})"""
    if not raw:
        return {}
    try:
        data = json.loads(raw)
        out = {int(k): clean_sig_text(str(v)) for k, v in data.items() if str(v).strip()}
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(400, f"row_overrides ไม่ถูกต้อง: {e}")
    return out


def _merged(db: Session, extra: List[dict]) -> Tuple[Dict[str, str], Dict[str, str]]:
    by_sig, by_drug = _load_library(db)
    for d in extra:
        (by_sig if d["key_type"] == "SIG" else by_drug)[d["key"]] = d["sig_text"]
    return by_sig, by_drug


@router.post("/preview")
async def preview(
    files: List[UploadFile] = File(...),
    overrides: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    contents = await _read_txt_uploads(files)
    by_sig, by_drug = _merged(db, _overrides(overrides))
    try:
        return preview_sig_fix(contents, by_sig=by_sig, by_drug=by_drug)
    except ValueError as e:
        raise HTTPException(422, str(e))


@router.post("/apply")
async def apply(
    files: List[UploadFile] = File(...),
    overrides: Optional[str] = Form(None),
    row_overrides: Optional[str] = Form(None),
    save_to_library: bool = Form(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    orig_zip_name = next(
        (f.filename.split("/")[-1].split("\\")[-1]
         for f in files if f.filename and f.filename.lower().endswith(".zip")),
        None,
    )
    contents = await _read_txt_uploads(files)
    extra = _overrides(overrides)
    by_sig, by_drug = _merged(db, extra)
    try:
        result = apply_sig_fix(contents, by_sig=by_sig, by_drug=by_drug,
                               by_row=_row_overrides(row_overrides))
    except ValueError as e:
        raise HTTPException(422, str(e))

    # จำวิธีใช้ที่กรอกครั้งนี้ไว้ใช้ครั้งหน้า (ถ้าผู้ใช้สั่ง)
    if save_to_library and extra:
        for d in extra:
            _upsert(db, d["key_type"], d["key"], d["sig_text"], d.get("description"), current_user.id)
        db.commit()

    headers = {
        "X-Sig-Filled": str(result.filled),
        "X-Sig-Cleaned": str(result.cleaned),
        "X-Sig-Unresolved": str(result.unresolved),
        "X-Fix-Changes": json.dumps(result.changes, ensure_ascii=True),
        "Access-Control-Expose-Headers": "X-Sig-Filled, X-Sig-Cleaned, X-Sig-Unresolved, X-Fix-Changes, X-Filename",
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
