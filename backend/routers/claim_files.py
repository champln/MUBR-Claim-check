"""
API router: File Claim Check & Correction
"""
import json
import io
import zipfile
from typing import Optional
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Any, List

from auth import get_current_user
from database import get_db
from models import (
    ClaimFileSession, ClaimFileRecord, ClaimFileSessionStatus, ClaimFundType, User
)
from services.claim_file_parser import parse_claim_files, detect_fund_type_from_content
from services.claim_file_validator import validate_claim_records

router = APIRouter(prefix="/claim-files", tags=["Claim File Check"])


# ─── Schemas ──────────────────────────────────────────────────────────────────

class IssueOut(BaseModel):
    code: str
    field: str
    message: str
    severity: str  # ERROR | WARNING


class ClaimFileRecordOut(BaseModel):
    id: int
    session_id: int
    visit_no: Optional[str]
    hn: Optional[str]
    cid: Optional[str]
    patient_name: Optional[str]
    visit_date: Optional[str]
    discharge_date: Optional[str]
    pdx: Optional[str]
    total_charge: float
    claim_amount: float
    copay_amount: float
    raw_data: Optional[str]    # JSON string
    issues: Optional[str]      # JSON string
    has_error: bool
    has_warning: bool
    is_edited: bool
    edited_data: Optional[str]

    class Config:
        from_attributes = True


class ClaimFileSessionOut(BaseModel):
    id: int
    session_name: str
    fund_type: ClaimFundType
    period_month: Optional[int]
    period_year: Optional[int]
    files_info: Optional[str]
    total_records: int
    error_count: int
    warning_count: int
    status: ClaimFileSessionStatus
    created_at: Any

    class Config:
        from_attributes = True


class EditRecordRequest(BaseModel):
    edited_data: dict   # JSON ฟิลด์ที่แก้ไข


# ─── Upload & parse ───────────────────────────────────────────────────────────

@router.post("/upload", response_model=ClaimFileSessionOut)
async def upload_claim_files(
    files: List[UploadFile] = File(...),
    session_name: str = Form(...),
    period_month: Optional[int] = Form(None),
    period_year: Optional[int] = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    อัปโหลดไฟล์ส่งเบิก (หลายไฟล์พร้อมกัน หรือไฟล์ zip เดียว)
    ระบบจะ detect ประเภทกองทุนอัตโนมัติ parse และ validate
    """
    contents: dict[str, bytes] = {}

    for upload in files:
        fname = upload.filename or "unknown"
        raw = await upload.read()

        # ถ้าเป็น ZIP ให้แตกออก
        if fname.lower().endswith(".zip"):
            try:
                with zipfile.ZipFile(io.BytesIO(raw)) as zf:
                    for zname in zf.namelist():
                        base = zname.split("/")[-1].split("\\")[-1]
                        if base and not base.startswith("."):
                            contents[base] = zf.read(zname)
            except Exception as e:
                raise HTTPException(400, f"ไม่สามารถแตกไฟล์ ZIP ได้: {e}")
        else:
            # ใช้เฉพาะ basename
            base = fname.split("/")[-1].split("\\")[-1]
            contents[base] = raw

    if not contents:
        raise HTTPException(400, "ไม่พบไฟล์ที่สามารถประมวลผลได้")

    # Parse
    try:
        raw_records, fund_type = parse_claim_files(contents)
    except Exception as e:
        raise HTTPException(422, f"ไม่สามารถ parse ไฟล์ได้: {e}")

    if not raw_records:
        raise HTTPException(422, "ไม่พบข้อมูล record ในไฟล์ที่อัปโหลด กรุณาตรวจสอบประเภทไฟล์")

    # Validate
    validated = validate_claim_records(raw_records, fund_type)

    # Create session
    session = ClaimFileSession(
        session_name=session_name,
        fund_type=fund_type,
        period_month=period_month,
        period_year=period_year,
        files_info=json.dumps(list(contents.keys()), ensure_ascii=False),
        total_records=len(validated),
        error_count=sum(1 for r in validated if r.get("has_error")),
        warning_count=sum(1 for r in validated if r.get("has_warning")),
        status=ClaimFileSessionStatus.COMPLETED,
        uploaded_by_id=current_user.id,
    )
    db.add(session)
    db.flush()

    # Save records
    for rec in validated:
        issues_list = rec.pop("issues", [])
        has_error = rec.pop("has_error", False)
        has_warning = rec.pop("has_warning", False)

        # Resolve display fields
        visit_no = rec.get("visit_no", "")
        hn = rec.get("hn", "")
        cid = rec.get("cid", "")
        patient_name = rec.get("patient_name", "")
        visit_date = (rec.get("visit_date") or rec.get("datetime") or rec.get("admit_date") or "")
        discharge_date = rec.get("discharge_date", "")
        pdx = rec.get("pdx", "")
        total_charge = float(rec.get("total_charge", 0.0))
        claim_amount = float(rec.get("claim_amount", 0.0))
        copay_amount = float(rec.get("copay", rec.get("copay_amount", 0.0)))

        db_rec = ClaimFileRecord(
            session_id=session.id,
            visit_no=visit_no,
            hn=hn,
            cid=cid,
            patient_name=patient_name,
            visit_date=visit_date[:20] if visit_date else None,
            discharge_date=discharge_date[:20] if discharge_date else None,
            pdx=pdx,
            total_charge=total_charge,
            claim_amount=claim_amount,
            copay_amount=copay_amount,
            raw_data=json.dumps(rec, ensure_ascii=False, default=str),
            issues=json.dumps(issues_list, ensure_ascii=False),
            has_error=has_error,
            has_warning=has_warning,
        )
        db.add(db_rec)

    db.commit()
    db.refresh(session)
    return session


# ─── List sessions ────────────────────────────────────────────────────────────

@router.get("/", response_model=List[ClaimFileSessionOut])
def list_sessions(
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return (
        db.query(ClaimFileSession)
        .order_by(ClaimFileSession.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )


@router.get("/{session_id}", response_model=ClaimFileSessionOut)
def get_session(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    s = db.query(ClaimFileSession).filter(ClaimFileSession.id == session_id).first()
    if not s:
        raise HTTPException(404, "ไม่พบ session")
    return s


@router.delete("/{session_id}")
def delete_session(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    s = db.query(ClaimFileSession).filter(ClaimFileSession.id == session_id).first()
    if not s:
        raise HTTPException(404, "ไม่พบ session")
    db.delete(s)
    db.commit()
    return {"message": "ลบ session เรียบร้อย"}


# ─── Records ──────────────────────────────────────────────────────────────────

@router.get("/{session_id}/records", response_model=List[ClaimFileRecordOut])
def list_records(
    session_id: int,
    skip: int = 0,
    limit: int = 200,
    has_error: Optional[bool] = None,
    has_warning: Optional[bool] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(ClaimFileRecord).filter(ClaimFileRecord.session_id == session_id)
    if has_error is not None:
        q = q.filter(ClaimFileRecord.has_error == has_error)
    if has_warning is not None:
        q = q.filter(ClaimFileRecord.has_warning == has_warning)
    if search:
        q = q.filter(
            ClaimFileRecord.visit_no.contains(search)
            | ClaimFileRecord.cid.contains(search)
            | ClaimFileRecord.patient_name.contains(search)
        )
    return q.offset(skip).limit(limit).all()


@router.get("/{session_id}/records/{record_id}", response_model=ClaimFileRecordOut)
def get_record(
    session_id: int,
    record_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rec = db.query(ClaimFileRecord).filter(
        ClaimFileRecord.id == record_id,
        ClaimFileRecord.session_id == session_id,
    ).first()
    if not rec:
        raise HTTPException(404, "ไม่พบ record")
    return rec


@router.patch("/{session_id}/records/{record_id}", response_model=ClaimFileRecordOut)
def edit_record(
    session_id: int,
    record_id: int,
    body: EditRecordRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    แก้ไขข้อมูลใน record – บันทึก edited_data และอัปเดต summary fields
    """
    rec = db.query(ClaimFileRecord).filter(
        ClaimFileRecord.id == record_id,
        ClaimFileRecord.session_id == session_id,
    ).first()
    if not rec:
        raise HTTPException(404, "ไม่พบ record")

    # Merge edited_data กับ existing
    existing = {}
    if rec.edited_data:
        try:
            existing = json.loads(rec.edited_data)
        except Exception:
            existing = {}

    merged = {**existing, **body.edited_data}
    rec.edited_data = json.dumps(merged, ensure_ascii=False)
    rec.is_edited = True

    # อัปเดต summary fields ถ้ามีการเปลี่ยนแปลง
    if "visit_no" in merged:
        rec.visit_no = merged["visit_no"]
    if "cid" in merged:
        rec.cid = merged["cid"]
    if "patient_name" in merged:
        rec.patient_name = merged["patient_name"]
    if "pdx" in merged:
        rec.pdx = merged["pdx"]
    if "total_charge" in merged:
        rec.total_charge = float(merged["total_charge"])
    if "claim_amount" in merged:
        rec.claim_amount = float(merged["claim_amount"])
    if "copay" in merged:
        rec.copay_amount = float(merged["copay"])

    db.commit()
    db.refresh(rec)
    return rec


# ─── Export summary ───────────────────────────────────────────────────────────

@router.get("/{session_id}/export-summary")
def export_summary(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Export สรุปผลการตรวจสอบเป็น JSON (สำหรับ download)
    """
    s = db.query(ClaimFileSession).filter(ClaimFileSession.id == session_id).first()
    if not s:
        raise HTTPException(404, "ไม่พบ session")

    records = db.query(ClaimFileRecord).filter(ClaimFileRecord.session_id == session_id).all()

    rows = []
    for r in records:
        issues = json.loads(r.issues) if r.issues else []
        rows.append({
            "visit_no": r.visit_no,
            "hn": r.hn,
            "cid": r.cid,
            "patient_name": r.patient_name,
            "visit_date": r.visit_date,
            "pdx": r.pdx,
            "total_charge": r.total_charge,
            "claim_amount": r.claim_amount,
            "copay_amount": r.copay_amount,
            "has_error": r.has_error,
            "has_warning": r.has_warning,
            "is_edited": r.is_edited,
            "issues": issues,
        })

    result = {
        "session": {
            "id": s.id,
            "session_name": s.session_name,
            "fund_type": s.fund_type.value,
            "total_records": s.total_records,
            "error_count": s.error_count,
            "warning_count": s.warning_count,
        },
        "records": rows,
    }

    json_bytes = json.dumps(result, ensure_ascii=False, indent=2).encode("utf-8")
    return StreamingResponse(
        io.BytesIO(json_bytes),
        media_type="application/json",
        headers={"Content-Disposition": f"attachment; filename=claim_check_{session_id}.json"},
    )
