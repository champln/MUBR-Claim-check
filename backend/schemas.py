from pydantic import BaseModel, Field
from typing import Optional, List, Any
from datetime import datetime
from models import ClaimType, ClaimStatus, BatchStatus, ErrorSeverity, UserRole, UserSource


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


class ValidationRuleBulkItem(ValidationRuleCreate):
    is_active: bool = True


class ValidationRuleBulkUpsertRequest(BaseModel):
    rules: List[ValidationRuleBulkItem]
    deactivate_missing: bool = False


class ValidationRuleBulkUpsertResult(BaseModel):
    created: int
    updated: int
    deactivated: int
    total_active: int


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


# ─── Authentication & RBAC ───────────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=100)
    password: str = Field(..., min_length=4, max_length=128)


class UserOut(BaseModel):
    id: int
    username: str
    full_name: Optional[str]
    source: UserSource
    external_ref: Optional[str]
    role: UserRole
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class UserCreateRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=100)
    full_name: Optional[str] = Field(None, max_length=200)
    password: str = Field(..., min_length=8, max_length=128)
    role: UserRole = UserRole.OPERATOR


class UserUpdateRequest(BaseModel):
    full_name: Optional[str] = Field(None, max_length=200)
    role: Optional[UserRole] = None
    is_active: Optional[bool] = None
    password: Optional[str] = Field(None, min_length=8, max_length=128)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(..., min_length=4, max_length=128)
    new_password: str = Field(..., min_length=8, max_length=128)


class UserAuditLogOut(BaseModel):
    id: int
    actor_user_id: int
    target_user_id: Optional[int]
    action: str
    detail: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


class HosxpUserSelectionCreateRequest(BaseModel):
    hosxp_username: str = Field(..., min_length=1, max_length=100)
    full_name: Optional[str] = Field(None, max_length=200)
    role: UserRole = UserRole.OPERATOR
    is_active: bool = True


class HosxpUserSelectionUpdateRequest(BaseModel):
    full_name: Optional[str] = Field(None, max_length=200)
    role: Optional[UserRole] = None
    is_active: Optional[bool] = None


class HosxpUserSelectionOut(BaseModel):
    id: int
    hosxp_username: str
    full_name: Optional[str]
    role: UserRole
    is_active: bool
    selected_by_user_id: Optional[int]
    selected_at: datetime
    last_synced_at: Optional[datetime]

    class Config:
        from_attributes = True


class HosxpSyncResult(BaseModel):
    created_users: int
    updated_users: int
    deactivated_users: int


class HosxpConnectionConfigUpsertRequest(BaseModel):
    db_url: str = Field(..., min_length=1)
    user_table: Optional[str] = Field(None, max_length=100)
    username_column: Optional[str] = Field(None, max_length=100)
    full_name_column: Optional[str] = Field(None, max_length=100)
    active_column: Optional[str] = Field(None, max_length=100)
    password_column: Optional[str] = Field(None, max_length=100)
    auth_method: Optional[str] = Field(None, max_length=30)
    is_enabled: bool = True


class HosxpConnectionConfigOut(BaseModel):
    id: int
    db_url: str
    user_table: Optional[str]
    username_column: Optional[str]
    full_name_column: Optional[str]
    active_column: Optional[str]
    password_column: Optional[str]
    auth_method: Optional[str]
    is_enabled: bool
    updated_by_user_id: Optional[int]
    updated_at: datetime

    class Config:
        from_attributes = True


class HosxpDetectAuthRequest(BaseModel):
    """admin กรอก user/รหัส HOSxP จริง 1 ครั้ง เพื่อให้ระบบหาวิธียืนยันรหัส"""
    username: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)


class HosxpDetectAuthResult(BaseModel):
    password_column: str
    auth_method: str
    saved: bool


class HosxpUserCandidateOut(BaseModel):
    hosxp_username: str
    full_name: Optional[str]
    is_active: bool
    already_selected: bool
    selected_active: bool


class HosxpSelectionBulkItem(BaseModel):
    hosxp_username: str = Field(..., min_length=1, max_length=100)
    full_name: Optional[str] = Field(None, max_length=200)
    role: UserRole = UserRole.OPERATOR
    is_active: bool = True


class HosxpSelectionBulkUpsertRequest(BaseModel):
    items: List[HosxpSelectionBulkItem]


class HosxpSelectionBulkUpsertResult(BaseModel):
    created: int
    updated: int


class LoginAuditLogOut(BaseModel):
    id: int
    username: str
    user_id: Optional[int]
    success: bool
    ip_address: Optional[str]
    user_agent: Optional[str]
    reason: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True
