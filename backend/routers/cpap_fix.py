"""
API router: แก้ไฟล์ส่งเบิก CPAP / sleep test (CSOP กรมบัญชีกลาง สกส.)

- POST   /cpap-fix/analyze              : วิเคราะห์ visit CPAP + สถานะ checksum
- POST   /cpap-fix/apply                : แก้ไฟล์ -> บันทึกประวัติ + ดาวน์โหลด zip
- GET    /cpap-fix/sessions             : ประวัติการแก้ (กรองตามปีงบได้)
- GET    /cpap-fix/sessions/{id}/download : โหลดไฟล์ที่แก้แล้วซ้ำ
- DELETE /cpap-fix/sessions/{id}        : ลบประวัติรายการเดียว
- GET    /cpap-fix/fiscal-years         : รายการปีงบประมาณ + จำนวน (สำหรับเคลียร์)
- DELETE /cpap-fix/sessions?fiscal_year=2569 : เคลียร์ลบทั้งปีงบ
"""
import io
import json
import zipfile
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Any

from auth import get_current_user
from database import get_db
from models import CpapFixSession, User
from services.csop_file_editor import analyze, apply_cpap_fix, thai_fiscal_year, build_zip_filename

router = APIRouter(prefix="/cpap-fix", tags=["CPAP Claim Fix"])


# ─── Schemas ──────────────────────────────────────────────────────────────────

class CpapSessionOut(BaseModel):
    id: int
    session_name: str
    fiscal_year: Optional[int]
    claim_types: Optional[str]
    pay_plan: Optional[str]
    service_date: Optional[str]
    visit_count: int
    file_count: int
    auth_codes: Optional[str]
    changes: Optional[str]
    visits_info: Optional[str]
    files_info: Optional[str]
    result_filename: Optional[str]
    created_at: Any

    class Config:
        from_attributes = True


class FiscalYearCount(BaseModel):
    fiscal_year: Optional[int]
    count: int


# ─── helpers ──────────────────────────────────────────────────────────────────

async def _read_uploads(files: List[UploadFile]) -> Dict[str, bytes]:
    """อ่านไฟล์อัปโหลด -> {ชื่อไฟล์(basename): bytes}; แตก zip อัตโนมัติ (เฉพาะ .txt)"""
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


def _zip_bytes(files: Dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in files.items():
            zf.writestr(name, data)
    return buf.getvalue()


# ─── Analyze ──────────────────────────────────────────────────────────────────

@router.post("/analyze")
async def analyze_files(
    files: List[UploadFile] = File(...),
    current_user: User = Depends(get_current_user),
):
    contents = await _read_uploads(files)
    try:
        return analyze(contents)
    except Exception as e:
        raise HTTPException(422, f"วิเคราะห์ไฟล์ไม่สำเร็จ: {e}")


# ─── Apply (+ save history) ───────────────────────────────────────────────────

@router.post("/apply")
async def apply_fix(
    files: List[UploadFile] = File(...),
    auth_codes: str = Form(...),                 # JSON: {visit_no: รหัสอนุมัติ}
    target_visits: Optional[str] = Form(None),   # JSON list หรือว่าง = auto-detect
    session_name: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    contents = await _read_uploads(files)

    try:
        auth_by_visit = json.loads(auth_codes) if auth_codes else {}
        if not isinstance(auth_by_visit, dict):
            raise ValueError("auth_codes ต้องเป็น object {visit_no: code}")
    except Exception as e:
        raise HTTPException(400, f"auth_codes ไม่ถูกต้อง: {e}")

    visits = None
    if target_visits:
        try:
            visits = json.loads(target_visits)
        except Exception as e:
            raise HTTPException(400, f"target_visits ไม่ถูกต้อง: {e}")

    # วิเคราะห์ก่อน เพื่อเก็บ metadata (ปีงบ, วันบริการ, snapshot visit)
    try:
        info = analyze(contents)
    except Exception:
        info = {}

    try:
        result = apply_cpap_fix(contents, auth_by_visit=auth_by_visit, target_visits=visits)
    except Exception as e:
        raise HTTPException(422, f"แก้ไฟล์ไม่สำเร็จ: {e}")

    result_zip = _zip_bytes(result.files)
    zip_name = build_zip_filename(contents)

    # บันทึกประวัติ
    sessno = info.get("sessno", "")
    service_date = info.get("service_date", "")
    fiscal_year = info.get("fiscal_year")
    visits_list = info.get("cpap_visits", [])
    # ถ้าระบุ target_visits ให้เก็บเฉพาะ visit ที่แก้จริง
    if visits:
        vset = set(visits)
        visits_list = [v for v in visits_list if v.get("visit_no") in vset]
    types = sorted({v.get("claim_type") for v in visits_list if v.get("claim_type")})
    claim_types = ",".join(types)
    name = (session_name or "").strip() or (
        f"CSOP {sessno} · {service_date}".strip(" ·") or "CPAP fix"
    )

    sess = CpapFixSession(
        session_name=name,
        fiscal_year=fiscal_year,
        claim_types=claim_types,
        pay_plan=info.get("pay_plan", ""),
        service_date=service_date,
        visit_count=len(visits_list),
        file_count=len(contents),
        auth_codes=json.dumps(auth_by_visit, ensure_ascii=False),
        changes=json.dumps(result.changes, ensure_ascii=False),
        visits_info=json.dumps(visits_list, ensure_ascii=False),
        files_info=json.dumps(list(contents.keys()), ensure_ascii=False),
        result_zip=result_zip,
        result_filename=zip_name,
        created_by_id=current_user.id,
    )
    db.add(sess)
    db.commit()
    db.refresh(sess)

    headers = {
        "Content-Disposition": f"attachment; filename={zip_name}",
        # header ต้องเป็น ASCII (latin-1) -> ใช้ \u escapes; frontend JSON.parse ถอดกลับเป็นไทยเอง
        "X-Fix-Changes": json.dumps(result.changes),
        "X-Session-Id": str(sess.id),
        "X-Zip-Filename": zip_name,
        "Access-Control-Expose-Headers": "X-Fix-Changes, X-Session-Id, X-Zip-Filename",
    }
    return StreamingResponse(io.BytesIO(result_zip), media_type="application/zip", headers=headers)


# ─── History ──────────────────────────────────────────────────────────────────

@router.get("/sessions", response_model=List[CpapSessionOut])
def list_sessions(
    fiscal_year: Optional[int] = Query(None),
    claim_type: Optional[str] = Query(None, description="CPAP หรือ PSG"),
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(CpapFixSession)
    if fiscal_year is not None:
        q = q.filter(CpapFixSession.fiscal_year == fiscal_year)
    if claim_type:
        q = q.filter(CpapFixSession.claim_types.contains(claim_type))
    return (
        q.order_by(CpapFixSession.created_at.desc())
        .offset(skip).limit(limit).all()
    )


@router.get("/fiscal-years", response_model=List[FiscalYearCount])
def list_fiscal_years(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from sqlalchemy import func as sfunc
    rows = (
        db.query(CpapFixSession.fiscal_year, sfunc.count(CpapFixSession.id))
        .group_by(CpapFixSession.fiscal_year)
        .order_by(CpapFixSession.fiscal_year.desc())
        .all()
    )
    return [{"fiscal_year": fy, "count": c} for fy, c in rows]


@router.get("/sessions/{session_id}/download")
def download_session(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    s = db.query(CpapFixSession).filter(CpapFixSession.id == session_id).first()
    if not s or not s.result_zip:
        raise HTTPException(404, "ไม่พบไฟล์ผลลัพธ์")
    return StreamingResponse(
        io.BytesIO(s.result_zip),
        media_type="application/zip",
        headers={"Content-Disposition": f"attachment; filename={s.result_filename or 'cpap_fixed.zip'}"},
    )


@router.delete("/sessions/{session_id}")
def delete_session(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    s = db.query(CpapFixSession).filter(CpapFixSession.id == session_id).first()
    if not s:
        raise HTTPException(404, "ไม่พบประวัติ")
    db.delete(s)
    db.commit()
    return {"message": "ลบประวัติเรียบร้อย"}


@router.delete("/sessions")
def clear_sessions_by_fiscal_year(
    fiscal_year: int = Query(..., description="ปีงบประมาณ (พ.ศ.) ที่จะเคลียร์ลบทั้งหมด"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    n = (
        db.query(CpapFixSession)
        .filter(CpapFixSession.fiscal_year == fiscal_year)
        .delete(synchronize_session=False)
    )
    db.commit()
    return {"message": f"เคลียร์ประวัติปีงบ {fiscal_year} จำนวน {n} รายการ", "deleted": n}
