from pydantic import BaseModel, Field
from typing import Optional, List, Any
from datetime import datetime
from models import ClaimType, ClaimStatus, BatchStatus, ErrorSeverity


# ─── Batch ────────────────────────────────────────────────────────────────────

class BatchCreate(BaseModel):
    claim_type: ClaimType
    period_month: Optional[int] = None
    period_year: Optional[int] = None
    uploaded_by: Optional[str] = "system"
    note: Optional[str] = None


class BatchOut(BaseModel):
    id: int
    batch_no: str
    filename: str
    claim_type: ClaimType
    period_month: Optional[int]
    period_year: Optional[int]
    total_records: int
    passed_records: int
    failed_records: int
    flagged_records: int
    total_amount: float
    status: BatchStatus
    uploaded_by: Optional[str]
    note: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


# ─── Claim Record ─────────────────────────────────────────────────────────────

class ClaimRecordOut(BaseModel):
    id: int
    batch_id: int
    row_number: Optional[int]
    hn: Optional[str]
    pid: Optional[str]
    patient_name: Optional[str]
    dob: Optional[str]
    age: Optional[int]
    visit_date: Optional[str]
    discharge_date: Optional[str]
    visit_type: Optional[str]
    los: Optional[int]
    ward: Optional[str]
    claim_type: Optional[ClaimType]
    claim_no: Optional[str]
    insurance_id: Optional[str]
    pdx: Optional[str]
    adx1: Optional[str]
    adx2: Optional[str]
    adx3: Optional[str]
    adx4: Optional[str]
    op1: Optional[str]
    op2: Optional[str]
    op3: Optional[str]
    drg_code: Optional[str]
    rw: Optional[float]
    adjrw: Optional[float]
    total_charge: float
    claim_amount: float
    drug_amount: float
    supply_amount: float
    service_amount: float
    copay_amount: float
    status: ClaimStatus
    is_flagged_c: bool
    flag_reason: Optional[str]
    errors: List["PreScreenErrorOut"] = []
    created_at: datetime

    class Config:
        from_attributes = True


# ─── Pre-screen Error ─────────────────────────────────────────────────────────

class PreScreenErrorOut(BaseModel):
    id: int
    claim_id: int
    error_code: str
    error_category: Optional[str]
    error_field: Optional[str]
    error_message: str
    error_message_th: Optional[str]
    current_value: Optional[str]
    expected_value: Optional[str]
    severity: ErrorSeverity
    is_resolved: bool
    resolved_note: Optional[str]

    class Config:
        from_attributes = True


ClaimRecordOut.model_rebuild()


# ─── Pre-screen Summary ───────────────────────────────────────────────────────

class PreScreenSummary(BaseModel):
    batch_id: int
    total: int
    passed: int
    failed: int
    flagged_c: int
    warnings: int
    error_categories: dict
    top_errors: List[dict]
    total_amount: float
    claim_amount: float


# ─── Validation Rule ──────────────────────────────────────────────────────────

class ValidationRuleCreate(BaseModel):
    rule_code: str
    rule_name: str
    rule_name_th: Optional[str] = None
    category: str
    claim_type: Optional[ClaimType] = None
    condition_type: str
    condition_value: Optional[str] = None
    severity: ErrorSeverity = ErrorSeverity.ERROR
    description: Optional[str] = None


class ValidationRuleOut(ValidationRuleCreate):
    id: int
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


# ─── Dashboard Stats ──────────────────────────────────────────────────────────

class DashboardStats(BaseModel):
    total_batches: int
    total_claims: int
    total_passed: int
    total_failed: int
    total_flagged_c: int
    total_amount: float
    recent_batches: List[BatchOut]
    monthly_summary: List[dict]
    error_type_summary: List[dict]


# ─── Generic Response ─────────────────────────────────────────────────────────

class MessageResponse(BaseModel):
    message: str
    detail: Optional[Any] = None
