"""
API router: Reports export & Dashboard stats
"""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import func
from sqlalchemy import and_
from auth import get_current_user, require_roles
from database import get_db
from models import ClaimBatch, ClaimRecord, PreScreenError, ClaimStatus, User, UserRole
from schemas import (
    DashboardStats,
    ValidationRuleCreate,
    ValidationRuleOut,
    ValidationRuleBulkUpsertRequest,
    ValidationRuleBulkUpsertResult,
    MessageResponse,
)
from models import ValidationRule
from services.report_generator import generate_excel_report
import io

router = APIRouter(tags=["Reports & Settings"])


# ─── Dashboard ────────────────────────────────────────────────────────────────

@router.get("/dashboard", response_model=DashboardStats)
def get_dashboard(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    total_batches = db.query(func.count(ClaimBatch.id)).scalar() or 0
    total_claims = db.query(func.count(ClaimRecord.id)).scalar() or 0
    total_passed = db.query(func.count(ClaimRecord.id)).filter(
        ClaimRecord.status == ClaimStatus.PASSED).scalar() or 0
    total_failed = db.query(func.count(ClaimRecord.id)).filter(
        ClaimRecord.status == ClaimStatus.FAILED).scalar() or 0
    total_flagged = db.query(func.count(ClaimRecord.id)).filter(
        ClaimRecord.status == ClaimStatus.FLAGGED_C).scalar() or 0
    total_amount = db.query(func.coalesce(func.sum(ClaimBatch.total_amount), 0)).scalar() or 0.0

    recent = (
        db.query(ClaimBatch)
        .order_by(ClaimBatch.created_at.desc())
        .limit(5)
        .all()
    )

    # Monthly summary (last 6 months)
    monthly = (
        db.query(
            ClaimBatch.period_year,
            ClaimBatch.period_month,
            func.sum(ClaimBatch.total_records).label("total"),
            func.sum(ClaimBatch.passed_records).label("passed"),
            func.sum(ClaimBatch.failed_records).label("failed"),
        )
        .group_by(ClaimBatch.period_year, ClaimBatch.period_month)
        .order_by(ClaimBatch.period_year.desc(), ClaimBatch.period_month.desc())
        .limit(6)
        .all()
    )

    monthly_data = [
        {
            "year": r.period_year,
            "month": r.period_month,
            "total": r.total,
            "passed": r.passed,
            "failed": r.failed,
        }
        for r in monthly
    ]

    # Error type summary
    err_summary = (
        db.query(
            PreScreenError.error_category,
            func.count(PreScreenError.id).label("count"),
        )
        .group_by(PreScreenError.error_category)
        .order_by(func.count(PreScreenError.id).desc())
        .all()
    )
    error_type_data = [{"category": r.error_category, "count": r.count} for r in err_summary]

    return DashboardStats(
        total_batches=total_batches,
        total_claims=total_claims,
        total_passed=total_passed,
        total_failed=total_failed,
        total_flagged_c=total_flagged,
        total_amount=float(total_amount),
        recent_batches=recent,
        monthly_summary=monthly_data,
        error_type_summary=error_type_data,
    )


# ─── Export Report ────────────────────────────────────────────────────────────

@router.get("/reports/{batch_id}/export")
def export_report(
    batch_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        data = generate_excel_report(db, batch_id)
    except ValueError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        raise HTTPException(500, f"Error generating report: {str(e)}")

    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="prescreen_batch_{batch_id}.xlsx"'},
    )


# ─── Validation Rules ─────────────────────────────────────────────────────────

@router.get("/rules", response_model=list[ValidationRuleOut])
def list_rules(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return db.query(ValidationRule).order_by(ValidationRule.id).all()


@router.post("/rules", response_model=ValidationRuleOut)
def create_rule(
    body: ValidationRuleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.REVIEWER)),
):
    existing = db.query(ValidationRule).filter(
        ValidationRule.rule_code == body.rule_code
    ).first()
    if existing:
        raise HTTPException(400, f"Rule code '{body.rule_code}' already exists")
    rule = ValidationRule(**body.model_dump())
    db.add(rule)
    db.commit()
    db.refresh(rule)
    return rule


@router.put("/rules/{rule_id}", response_model=ValidationRuleOut)
def update_rule(
    rule_id: int,
    body: ValidationRuleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.REVIEWER)),
):
    rule = db.query(ValidationRule).filter(ValidationRule.id == rule_id).first()
    if not rule:
        raise HTTPException(404, "Rule not found")
    for k, v in body.model_dump().items():
        setattr(rule, k, v)
    db.commit()
    db.refresh(rule)
    return rule


@router.delete("/rules/{rule_id}", response_model=MessageResponse)
def delete_rule(
    rule_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN)),
):
    rule = db.query(ValidationRule).filter(ValidationRule.id == rule_id).first()
    if not rule:
        raise HTTPException(404, "Rule not found")
    db.delete(rule)
    db.commit()
    return {"message": f"Rule {rule_id} deleted"}


@router.patch("/rules/{rule_id}/toggle", response_model=ValidationRuleOut)
def toggle_rule(
    rule_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.REVIEWER)),
):
    rule = db.query(ValidationRule).filter(ValidationRule.id == rule_id).first()
    if not rule:
        raise HTTPException(404, "Rule not found")
    rule.is_active = not rule.is_active
    db.commit()
    db.refresh(rule)
    return rule


@router.post("/rules/bulk-upsert", response_model=ValidationRuleBulkUpsertResult)
def bulk_upsert_rules(
    body: ValidationRuleBulkUpsertRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.REVIEWER)),
):
    """
    Bulk create/update validation rules.
    Designed for continuously changing rule sets from external guideline updates.
    """
    if not body.rules:
        raise HTTPException(400, "rules payload is empty")

    created = 0
    updated = 0
    deactivated = 0

    incoming_codes = {item.rule_code for item in body.rules}
    existing_rules = db.query(ValidationRule).all()
    existing_by_code = {r.rule_code: r for r in existing_rules}

    for item in body.rules:
        payload = item.model_dump()
        code = payload["rule_code"]

        if code in existing_by_code:
            rule = existing_by_code[code]
            for k, v in payload.items():
                setattr(rule, k, v)
            updated += 1
        else:
            db.add(ValidationRule(**payload))
            created += 1

    if body.deactivate_missing:
        to_deactivate = (
            db.query(ValidationRule)
            .filter(and_(ValidationRule.is_active == True, ~ValidationRule.rule_code.in_(incoming_codes)))
            .all()
        )
        for rule in to_deactivate:
            rule.is_active = False
            deactivated += 1

    db.commit()

    total_active = db.query(func.count(ValidationRule.id)).filter(ValidationRule.is_active == True).scalar() or 0
    return ValidationRuleBulkUpsertResult(
        created=created,
        updated=updated,
        deactivated=deactivated,
        total_active=total_active,
    )


@router.get("/rules/export", response_model=list[ValidationRuleOut])
def export_rules(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Export all rules as JSON for backup/versioning."""
    return db.query(ValidationRule).order_by(ValidationRule.id).all()
