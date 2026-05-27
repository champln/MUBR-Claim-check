"""
API router: Upload & Pre-screen
"""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from typing import Optional
import uuid
from datetime import datetime
from database import get_db
from models import (
    ClaimBatch, ClaimRecord, PreScreenError, ValidationRule,
    ClaimType, ClaimStatus, BatchStatus, ErrorSeverity
)
from schemas import BatchOut, PreScreenSummary
from services.excel_parser import parse_excel_to_records
from services.claim_checker import run_prescreen

router = APIRouter(prefix="/prescreen", tags=["Pre-screen"])


def _normalize_claim_type(raw: str) -> ClaimType:
    raw = (raw or "").upper()
    if "SSO" in raw or "ประกันสังคม" in raw:
        return ClaimType.SSO
    if "CSMBS" in raw or "ข้าราชการ" in raw:
        return ClaimType.CSMBS
    if "UC" in raw or "บัตรทอง" in raw or "30" in raw:
        return ClaimType.UC
    if "LGW" in raw or "ท้องถิ่น" in raw:
        return ClaimType.LGW
    if "ECLAIM" in raw or "E-CLAIM" in raw:
        return ClaimType.ECLAIM
    return ClaimType.OTHER


@router.post("/upload", response_model=BatchOut)
async def upload_and_prescreen(
    file: UploadFile = File(...),
    claim_type: str = Form(...),
    period_month: Optional[int] = Form(None),
    period_year: Optional[int] = Form(None),
    uploaded_by: Optional[str] = Form("system"),
    note: Optional[str] = Form(None),
    db: Session = Depends(get_db),
):
    """Upload a claim file (Excel/CSV) and run pre-screen checks"""
    if not file.filename.lower().endswith((".xlsx", ".xls", ".csv")):
        raise HTTPException(400, "รองรับเฉพาะไฟล์ .xlsx, .xls, .csv เท่านั้น")

    file_bytes = await file.read()
    if len(file_bytes) > 50 * 1024 * 1024:  # 50 MB limit
        raise HTTPException(413, "ไฟล์ขนาดใหญ่เกินไป (ไม่เกิน 50 MB)")

    # Parse file
    try:
        records = parse_excel_to_records(file_bytes, file.filename)
    except Exception as e:
        raise HTTPException(422, f"ไม่สามารถอ่านไฟล์ได้: {str(e)}")

    if not records:
        raise HTTPException(422, "ไม่พบข้อมูลในไฟล์")

    # Create batch
    batch_no = f"BATCH-{datetime.now().strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:6].upper()}"
    ct = _normalize_claim_type(claim_type)

    batch = ClaimBatch(
        batch_no=batch_no,
        filename=file.filename,
        claim_type=ct,
        period_month=period_month,
        period_year=period_year,
        uploaded_by=uploaded_by,
        note=note,
        status=BatchStatus.PROCESSING,
    )
    db.add(batch)
    db.flush()  # get batch.id

    # Load active custom rules
    custom_rules = [
        {
            "rule_code": r.rule_code,
            "rule_name": r.rule_name,
            "rule_name_th": r.rule_name_th,
            "category": r.category,
            "condition_type": r.condition_type,
            "condition_value": r.condition_value,
            "severity": r.severity.value,
            "is_active": r.is_active,
        }
        for r in db.query(ValidationRule).filter(ValidationRule.is_active == True).all()
    ]

    total_amount = 0.0
    passed = failed = flagged_c = 0

    for rec_data in records:
        # Normalize claim type from row data (may override batch-level)
        row_ct = rec_data.pop("claim_type", None)
        if row_ct:
            rec_data["claim_type"] = _normalize_claim_type(row_ct)
        else:
            rec_data["claim_type"] = ct

        claim = ClaimRecord(batch_id=batch.id, **{
            k: v for k, v in rec_data.items()
            if k in ClaimRecord.__table__.columns.keys()
        })
        db.add(claim)
        db.flush()

        # Run pre-screen
        errors, is_c, flag_reason = run_prescreen(rec_data, custom_rules)

        claim.is_flagged_c = is_c
        claim.flag_reason = flag_reason if is_c else None

        has_error = False
        for err in errors:
            db.add(PreScreenError(
                claim_id=claim.id,
                error_code=err.error_code,
                error_category=err.error_category,
                error_field=err.error_field,
                error_message=err.error_message,
                error_message_th=err.error_message_th,
                current_value=err.current_value,
                expected_value=err.expected_value,
                severity=ErrorSeverity(err.severity),
            ))
            if err.severity == "ERROR":
                has_error = True

        if is_c:
            claim.status = ClaimStatus.FLAGGED_C
            flagged_c += 1
        elif has_error:
            claim.status = ClaimStatus.FAILED
            failed += 1
        else:
            claim.status = ClaimStatus.PASSED
            passed += 1

        total_amount += rec_data.get("total_charge") or 0.0

    # Update batch summary
    batch.total_records = len(records)
    batch.passed_records = passed
    batch.failed_records = failed
    batch.flagged_records = flagged_c
    batch.total_amount = total_amount
    batch.status = BatchStatus.COMPLETED

    db.commit()
    db.refresh(batch)
    return batch


@router.get("/{batch_id}/summary", response_model=PreScreenSummary)
def get_prescreen_summary(batch_id: int, db: Session = Depends(get_db)):
    batch = db.query(ClaimBatch).filter(ClaimBatch.id == batch_id).first()
    if not batch:
        raise HTTPException(404, "Batch not found")

    claims = db.query(ClaimRecord).filter(ClaimRecord.batch_id == batch_id).all()
    errors = [e for c in claims for e in c.errors]

    # Error category counts
    category_counts: dict = {}
    for e in errors:
        cat = e.error_category or "OTHER"
        category_counts[cat] = category_counts.get(cat, 0) + 1

    # Top error codes
    code_counts: dict = {}
    for e in errors:
        code_counts[e.error_code] = code_counts.get(e.error_code, 0) + 1
    top_errors = sorted(
        [{"code": k, "count": v, "message_th": next(
            (x.error_message_th for x in errors if x.error_code == k), ""
        )} for k, v in code_counts.items()],
        key=lambda x: x["count"], reverse=True
    )[:10]

    warnings = sum(1 for e in errors if e.severity == ErrorSeverity.WARNING)

    return PreScreenSummary(
        batch_id=batch_id,
        total=batch.total_records,
        passed=batch.passed_records,
        failed=batch.failed_records,
        flagged_c=batch.flagged_records,
        warnings=warnings,
        error_categories=category_counts,
        top_errors=top_errors,
        total_amount=batch.total_amount,
        claim_amount=sum(c.claim_amount or 0 for c in claims),
    )


@router.post("/{batch_id}/rerun", response_model=PreScreenSummary)
def rerun_prescreen(batch_id: int, db: Session = Depends(get_db)):
    """Re-run pre-screen on an existing batch (after rule changes)"""
    batch = db.query(ClaimBatch).filter(ClaimBatch.id == batch_id).first()
    if not batch:
        raise HTTPException(404, "Batch not found")

    # Clear existing errors
    claims = db.query(ClaimRecord).filter(ClaimRecord.batch_id == batch_id).all()
    for claim in claims:
        for err in claim.errors:
            db.delete(err)
        claim.status = ClaimStatus.PENDING
    db.flush()

    custom_rules = [
        {
            "rule_code": r.rule_code,
            "rule_name": r.rule_name,
            "rule_name_th": r.rule_name_th,
            "category": r.category,
            "condition_type": r.condition_type,
            "condition_value": r.condition_value,
            "severity": r.severity.value,
            "is_active": r.is_active,
        }
        for r in db.query(ValidationRule).filter(ValidationRule.is_active == True).all()
    ]

    passed = failed = flagged_c = 0
    for claim in claims:
        rec_data = {col: getattr(claim, col) for col in [
            "hn", "pid", "patient_name", "dob", "age", "visit_date", "discharge_date",
            "visit_type", "los", "ward", "claim_type", "claim_no", "insurance_id",
            "pdx", "adx1", "adx2", "adx3", "adx4", "op1", "op2", "op3",
            "drg_code", "rw", "adjrw", "total_charge", "claim_amount",
            "drug_amount", "supply_amount", "service_amount", "copay_amount",
        ]}
        if rec_data.get("claim_type"):
            rec_data["claim_type"] = rec_data["claim_type"].value

        errors, is_c, flag_reason = run_prescreen(rec_data, custom_rules)

        claim.is_flagged_c = is_c
        claim.flag_reason = flag_reason if is_c else None
        has_error = False
        for err in errors:
            db.add(PreScreenError(
                claim_id=claim.id,
                error_code=err.error_code,
                error_category=err.error_category,
                error_field=err.error_field,
                error_message=err.error_message,
                error_message_th=err.error_message_th,
                current_value=err.current_value,
                expected_value=err.expected_value,
                severity=ErrorSeverity(err.severity),
            ))
            if err.severity == "ERROR":
                has_error = True

        if is_c:
            claim.status = ClaimStatus.FLAGGED_C
            flagged_c += 1
        elif has_error:
            claim.status = ClaimStatus.FAILED
            failed += 1
        else:
            claim.status = ClaimStatus.PASSED
            passed += 1

    batch.passed_records = passed
    batch.failed_records = failed
    batch.flagged_records = flagged_c
    db.commit()

    return get_prescreen_summary(batch_id, db)
