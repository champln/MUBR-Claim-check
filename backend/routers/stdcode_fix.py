"""
API router: แก้รหัสหัตถการในแฟ้ม OPServices — กัน C รหัส S19 / S41

S41 : Class = OP (หัตถการ) แต่ STDCode ว่าง          -> เติมรหัสหัตถการ
S19 : รหัสการให้บริการไม่ถูกต้อง/ไม่สัมพันธ์กับ CodeSet -> แทนที่ด้วยรหัสจากคลังรหัส

ที่มาของรหัสที่ใช้เติม (เรียงตามความน่าเชื่อถือ):
  1) คลังรหัสหัตถการที่บันทึกไว้ในระบบ (LocalCode -> STDCode)
  2) เรียนรู้จากไฟล์เดียวกัน — แถวอื่นที่ LocalCode เดียวกันกรอก STDCode ไว้แล้ว

- GET/POST/DELETE /stdcode-fix/library : จัดการคลังรหัส
- POST /stdcode-fix/preview            : ดูว่าแถวไหนจะถูกแก้ (ยังไม่แก้)
- POST /stdcode-fix/apply              : แก้ + ดาวน์โหลดไฟล์ (ชื่อเดิม)
"""
import io
import json
import zipfile
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from models import StdCodeMapping, User
from services.csop_file_editor import (
    apply_stdcode_fix,
    build_zip_filename,
    preview_stdcode_fix,
)

router = APIRouter(prefix="/stdcode-fix", tags=["OPServices STDCode Fix (S19/S41)"])


# ─── คลังรหัสหัตถการ ─────────────────────────────────────────────────────────

class MappingIn(BaseModel):
    local_code: str
    std_code: str
    description: Optional[str] = None
    source: str = "MANUAL"


def _load_library(db: Session) -> Dict[str, str]:
    return {m.local_code: m.std_code for m in db.query(StdCodeMapping).all()}


@router.get("/library")
def list_library(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = db.query(StdCodeMapping).order_by(StdCodeMapping.local_code).all()
    return [
        {
            "id": m.id, "local_code": m.local_code, "std_code": m.std_code,
            "description": m.description or "", "source": m.source,
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
    """เพิ่ม/แก้รหัสในคลัง (local_code ซ้ำ = ทับของเดิม)"""
    saved = 0
    for item in items:
        local = (item.local_code or "").strip()
        std = (item.std_code or "").strip()
        if not local or not std:
            continue
        row = db.query(StdCodeMapping).filter(StdCodeMapping.local_code == local).first()
        if row is None:
            row = StdCodeMapping(local_code=local)
            db.add(row)
        row.std_code = std
        if item.description is not None:
            row.description = item.description.strip()
        row.source = item.source or "MANUAL"
        row.updated_by_id = current_user.id
        saved += 1
    db.commit()
    return {"saved": saved, "total": db.query(StdCodeMapping).count()}


@router.delete("/library/{mapping_id}")
def delete_library(
    mapping_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    row = db.query(StdCodeMapping).filter(StdCodeMapping.id == mapping_id).first()
    if row is None:
        raise HTTPException(404, "ไม่พบรหัสที่ต้องการลบ")
    db.delete(row)
    db.commit()
    return {"deleted": mapping_id}


# ─── ตรวจ/แก้ไฟล์ ────────────────────────────────────────────────────────────

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


def _extra_map(overrides: Optional[str]) -> Dict[str, str]:
    """รหัสที่ผู้ใช้กรอกสดในหน้าเว็บ (JSON: {local_code: std_code}) — ใช้ครั้งนี้เท่านั้น"""
    if not overrides:
        return {}
    try:
        data = json.loads(overrides)
    except Exception as e:
        raise HTTPException(400, f"overrides ไม่ถูกต้อง: {e}")
    if not isinstance(data, dict):
        raise HTTPException(400, "overrides ต้องเป็น object {local_code: std_code}")
    return {str(k).strip(): str(v).strip() for k, v in data.items() if str(k).strip() and str(v).strip()}


@router.post("/preview")
async def preview(
    files: List[UploadFile] = File(...),
    use_file_learning: bool = Form(True),
    replace_existing: bool = Form(False),
    overrides: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    contents = await _read_txt_uploads(files)
    library = {**_load_library(db), **_extra_map(overrides)}
    try:
        return preview_stdcode_fix(
            contents, library=library,
            use_file_learning=use_file_learning, replace_existing=replace_existing,
        )
    except ValueError as e:
        raise HTTPException(422, str(e))


@router.post("/apply")
async def apply(
    files: List[UploadFile] = File(...),
    use_file_learning: bool = Form(True),
    replace_existing: bool = Form(False),
    overrides: Optional[str] = Form(None),
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
    extra = _extra_map(overrides)
    library = {**_load_library(db), **extra}
    try:
        result = apply_stdcode_fix(
            contents, library=library,
            use_file_learning=use_file_learning, replace_existing=replace_existing,
        )
    except ValueError as e:
        raise HTTPException(422, str(e))

    # จำรหัสที่ใช้ครั้งนี้ไว้ใช้ครั้งหน้า (ถ้าผู้ใช้สั่ง)
    if save_to_library and extra:
        for local, std in extra.items():
            row = db.query(StdCodeMapping).filter(StdCodeMapping.local_code == local).first()
            if row is None:
                row = StdCodeMapping(local_code=local, source="MANUAL")
                db.add(row)
            row.std_code = std
            row.updated_by_id = current_user.id
        db.commit()

    headers = {
        "X-Stdcode-Filled": str(result.filled),
        "X-Stdcode-Replaced": str(result.replaced),
        "X-Stdcode-Unresolved": str(result.unresolved),
        "X-Fix-Changes": json.dumps(result.changes),
        "Access-Control-Expose-Headers": (
            "X-Stdcode-Filled, X-Stdcode-Replaced, X-Stdcode-Unresolved, X-Fix-Changes, X-Filename"
        ),
    }

    ops_name = next((n for n in contents if "OPSERVICES" in n.upper()), None)
    # อัปโหลดไฟล์ .txt เดี่ยว -> คืนไฟล์ชื่อเดิม
    if ops_name and len(contents) == 1 and not orig_zip_name:
        headers["Content-Disposition"] = f"attachment; filename={ops_name}"
        headers["X-Filename"] = ops_name
        return StreamingResponse(
            io.BytesIO(result.files[ops_name]),
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
