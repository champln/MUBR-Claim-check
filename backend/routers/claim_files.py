"""
API router: File Claim Check & Correction
"""
import json
import re
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
from services.c_code_checker import check_c_codes
from services.raw_row_editor import apply_edits, read_sections

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
    has_source: bool = False       # แก้ไขระดับฟิลด์ + เซ็น MD5 ได้ไหม
    pending_edits: int = 0         # จำนวนช่องที่แก้ค้างไว้

    class Config:
        from_attributes = True


class EditRecordRequest(BaseModel):
    edited_data: dict   # JSON ฟิลด์ที่แก้ไข


# ─── Upload & parse ───────────────────────────────────────────────────────────

# ─── อ่านข้อมูลงวดจากไฟล์ (เติมฟอร์มอัตโนมัติ) ────────────────────────────────

_DATE_RE = re.compile(r"(\d{4})-?(\d{2})-?(\d{2})")


def _visit_month(value: str):
    """'2026-03-10 08:00:00' / '20260310' / '2569-03-10' -> (ปี พ.ศ., เดือน)"""
    m = _DATE_RE.search(value or "")
    if not m:
        return None
    y, mo = int(m.group(1)), int(m.group(2))
    if not 1 <= mo <= 12:
        return None
    return (y if y > 2400 else y + 543), mo


@router.post("/inspect")
async def inspect_claim_files(
    files: List[UploadFile] = File(...),
    current_user: User = Depends(get_current_user),
):
    """
    อ่านไฟล์แบบยังไม่บันทึก เพื่อเติมฟอร์ม: ประเภทกองทุน, เลขงวด, เดือน/ปีที่รับบริการ
    เดือน = เดือนที่รับบริการที่มี visit มากที่สุด (ไม่ใช่วันที่ export)
    """
    contents: dict[str, bytes] = {}
    for upload in files:
        fname = upload.filename or "unknown"
        raw = await upload.read()
        if fname.lower().endswith(".zip"):
            try:
                with zipfile.ZipFile(io.BytesIO(raw)) as zf:
                    for zname in zf.namelist():
                        base = zname.split("/")[-1].split("\\")[-1]
                        if base and not base.startswith("."):
                            contents[base] = zf.read(zname)
            except Exception:
                continue
        else:
            contents[fname.split("/")[-1].split("\\")[-1]] = raw
    if not contents:
        raise HTTPException(400, "ไม่พบไฟล์ที่อ่านได้")

    try:
        records, fund_type = parse_claim_files(contents)
    except Exception as e:
        raise HTTPException(422, f"อ่านไฟล์ไม่สำเร็จ: {e}")

    counts: dict = {}
    for rec in records:
        ym = _visit_month(str(rec.get("visit_date") or rec.get("datetime") or rec.get("admit_date") or ""))
        if ym:
            counts[ym] = counts.get(ym, 0) + 1

    # เลขงวดจาก header ของ CHI (ไม่มีใน AIPN/LGO ก็ปล่อยว่าง)
    sessno = ""
    for name, data in contents.items():
        m = re.search(rb"<SESSNO>\s*([^<\s]+)\s*</SESSNO>", data)
        if m:
            sessno = m.group(1).decode("ascii", "ignore")
            break

    ranked = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    top = ranked[0][0] if ranked else None
    return {
        "fund_type": fund_type,
        "sessno": sessno,
        "record_count": len(records),
        "period_year": top[0] if top else None,
        "period_month": top[1] if top else None,
        "months": [{"year": y, "month": mo, "count": c} for (y, mo), c in ranked],
    }


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
    # ชื่อ zip เดิม — คืนไฟล์ผลลัพธ์ด้วยชื่อเดิมเสมอ (กองทุนต้องการรูปแบบชื่อเดิม)
    orig_zip_name = next(
        (f.filename.split("/")[-1].split("\\")[-1]
         for f in files if f.filename and f.filename.lower().endswith(".zip")),
        None,
    )

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
    # เก็บไฟล์ต้นฉบับไว้ (zip) เพื่อให้แก้ระดับฟิลด์แล้วเซ็น Checksum ใหม่ได้ภายหลัง
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for fname, data in contents.items():
            zf.writestr(fname, data)
    session.source_zip = buf.getvalue()
    session.source_filename = orig_zip_name or f"{session_name}.zip"

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


# ─── แก้ไขไฟล์ระดับฟิลด์ + เซ็น Checksum ใหม่ ────────────────────────────────────

class RawEdit(BaseModel):
    file: str
    section: str
    row: int        # ลำดับแถวในsection (เริ่มที่ 0)
    field: int      # ลำดับฟิลด์ (เริ่มที่ 0)
    value: str


class RawEditsRequest(BaseModel):
    edits: List[RawEdit]
    replace: bool = False   # True = แทนที่รายการแก้ไขเดิมทั้งหมด


def _load_source(session: ClaimFileSession) -> dict:
    if not session.source_zip:
        raise HTTPException(
            422,
            "session นี้อัปโหลดก่อนระบบจะเก็บไฟล์ต้นฉบับ — กรุณาอัปโหลดไฟล์ใหม่อีกครั้งเพื่อแก้ไขระดับฟิลด์",
        )
    with zipfile.ZipFile(io.BytesIO(session.source_zip)) as zf:
        return {n: zf.read(n) for n in zf.namelist()}


def _stored_edits(session: ClaimFileSession) -> List[dict]:
    if not session.raw_edits:
        return []
    try:
        data = json.loads(session.raw_edits)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _get_session_or_404(session_id: int, db: Session) -> ClaimFileSession:
    s = db.query(ClaimFileSession).filter(ClaimFileSession.id == session_id).first()
    if not s:
        raise HTTPException(404, "ไม่พบ session")
    return s


@router.get("/{session_id}/raw")
def get_raw(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """อ่านไฟล์ทั้งชุดเป็นตารางระดับฟิลด์ (ใช้ค่าที่แก้ไว้แล้วถ้ามี)"""
    s = _get_session_or_404(session_id, db)
    files = _load_source(s)
    edits = _stored_edits(s)
    if edits:
        try:
            files = apply_edits(files, edits)
        except ValueError as e:
            raise HTTPException(422, f"ใช้รายการแก้ไขที่บันทึกไว้ไม่สำเร็จ: {e}")
    return {
        "session_id": s.id,
        "source_filename": s.source_filename,
        "pending_edits": len(edits),
        "files": read_sections(files),
    }


@router.patch("/{session_id}/raw")
def patch_raw(
    session_id: int,
    body: RawEditsRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """บันทึกการแก้ไขระดับฟิลด์ (ยังไม่สร้างไฟล์ — ตรวจว่าใช้ได้จริงก่อนเก็บ)"""
    s = _get_session_or_404(session_id, db)
    files = _load_source(s)

    incoming = [e.model_dump() if hasattr(e, "model_dump") else e.dict() for e in body.edits]
    merged = [] if body.replace else _stored_edits(s)
    # แก้ช่องเดิมซ้ำ = ทับของเดิม
    index = {(e["file"], e["section"], e["row"], e["field"]): e for e in merged}
    for e in incoming:
        index[(e["file"], e["section"], e["row"], e["field"])] = e
    merged = list(index.values())

    try:
        apply_edits(files, merged)   # ตรวจว่าใช้ได้จริง
    except ValueError as e:
        raise HTTPException(422, str(e))

    s.raw_edits = json.dumps(merged, ensure_ascii=False)
    db.commit()
    return {"saved": len(incoming), "pending_edits": len(merged)}


@router.delete("/{session_id}/raw")
def reset_raw(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """ล้างการแก้ไขทั้งหมด กลับไปใช้ไฟล์ต้นฉบับ"""
    s = _get_session_or_404(session_id, db)
    s.raw_edits = None
    db.commit()
    return {"pending_edits": 0}


@router.get("/{session_id}/raw/download")
def download_raw(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """สร้างไฟล์ที่แก้แล้ว เซ็น Checksum (MD5) ใหม่ และดาวน์โหลดเป็น zip ชื่อเดิม"""
    s = _get_session_or_404(session_id, db)
    files = _load_source(s)
    edits = _stored_edits(s)
    if not edits:
        raise HTTPException(422, "ยังไม่มีการแก้ไข — ไม่มีอะไรให้ดาวน์โหลด")
    try:
        files = apply_edits(files, edits)
    except ValueError as e:
        raise HTTPException(422, str(e))

    touched = sorted({e["file"] for e in edits})
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, data in files.items():
            zf.writestr(name, data)
    zip_name = s.source_filename or f"claim_{s.id}.zip"
    headers = {
        "Content-Disposition": f"attachment; filename={zip_name}",
        "X-Filename": zip_name,
        "X-Edit-Count": str(len(edits)),
        "X-Files-Changed": json.dumps(touched, ensure_ascii=False),
        "Access-Control-Expose-Headers": "X-Filename, X-Edit-Count, X-Files-Changed",
    }
    return StreamingResponse(io.BytesIO(buf.getvalue()), media_type="application/zip", headers=headers)


@router.get("/{session_id}/c-check")
def c_check(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """ตรวจหาเงื่อนไขติด C ทุกแบบในชุดไฟล์นี้ครั้งเดียว (ใช้ค่าที่แก้ไว้แล้วถ้ามี)"""
    s = _get_session_or_404(session_id, db)
    files = _load_source(s)
    edits = _stored_edits(s)
    if edits:
        try:
            files = apply_edits(files, edits)
        except ValueError:
            pass
    return check_c_codes(files)
