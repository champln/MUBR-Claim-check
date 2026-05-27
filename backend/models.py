from sqlalchemy import (
    Column, Integer, String, Float, DateTime, Boolean,
    Text, ForeignKey, Enum as SAEnum
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum
from database import Base


class ClaimType(str, enum.Enum):
    SSO = "SSO"           # ประกันสังคม
    CSMBS = "CSMBS"       # สวัสดิการข้าราชการ
    UC = "UC"             # บัตรทอง 30 บาท
    LGW = "LGW"           # สวัสดิการพนักงานส่วนท้องถิ่น
    ECLAIM = "ECLAIM"     # E-claim
    OPD_SELF = "OPD_SELF" # ชำระเอง
    OTHER = "OTHER"       # อื่นๆ


class ClaimStatus(str, enum.Enum):
    PENDING = "PENDING"         # รอตรวจสอบ
    PASSED = "PASSED"           # ผ่านการตรวจสอบ
    FAILED = "FAILED"           # ไม่ผ่านการตรวจสอบ
    FLAGGED_C = "FLAGGED_C"     # ติด C
    CORRECTED = "CORRECTED"     # แก้ไขแล้ว
    REJECTED = "REJECTED"       # ปฏิเสธ


class BatchStatus(str, enum.Enum):
    PROCESSING = "PROCESSING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class ClaimBatch(Base):
    """Batch of claims from one file upload"""
    __tablename__ = "claim_batches"

    id = Column(Integer, primary_key=True, index=True)
    batch_no = Column(String(50), unique=True, index=True)
    filename = Column(String(255), nullable=False)
    claim_type = Column(SAEnum(ClaimType), nullable=False)
    period_month = Column(Integer)
    period_year = Column(Integer)
    total_records = Column(Integer, default=0)
    passed_records = Column(Integer, default=0)
    failed_records = Column(Integer, default=0)
    flagged_records = Column(Integer, default=0)
    total_amount = Column(Float, default=0.0)
    status = Column(SAEnum(BatchStatus), default=BatchStatus.PROCESSING)
    uploaded_by = Column(String(100))
    note = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    claims = relationship("ClaimRecord", back_populates="batch", cascade="all, delete-orphan")


class ClaimRecord(Base):
    """Individual claim record"""
    __tablename__ = "claim_records"

    id = Column(Integer, primary_key=True, index=True)
    batch_id = Column(Integer, ForeignKey("claim_batches.id"), nullable=False)
    row_number = Column(Integer)

    # Patient info
    hn = Column(String(20))           # HN
    pid = Column(String(20))          # เลขบัตรประชาชน
    patient_name = Column(String(200))
    dob = Column(String(20))          # วันเกิด
    age = Column(Integer)

    # Visit info
    visit_date = Column(String(20))   # วันที่รักษา
    discharge_date = Column(String(20))
    visit_type = Column(String(10))   # OPD/IPD
    los = Column(Integer)             # Length of Stay (IPD)
    ward = Column(String(50))

    # Claim info
    claim_type = Column(SAEnum(ClaimType))
    claim_no = Column(String(50))
    insurance_id = Column(String(50)) # เลขที่กรมธรรม์/สิทธิ์

    # Diagnosis
    pdx = Column(String(20))          # Principal Diagnosis ICD-10
    adx1 = Column(String(20))         # Additional Dx 1
    adx2 = Column(String(20))
    adx3 = Column(String(20))
    adx4 = Column(String(20))

    # Procedure
    op1 = Column(String(20))          # ICD-9-CM / ICD-10-PCS
    op2 = Column(String(20))
    op3 = Column(String(20))

    # DRG
    drg_code = Column(String(20))
    rw = Column(Float)                # Relative Weight
    adjrw = Column(Float)             # Adjusted RW

    # Financial
    total_charge = Column(Float, default=0.0)
    claim_amount = Column(Float, default=0.0)
    drug_amount = Column(Float, default=0.0)
    supply_amount = Column(Float, default=0.0)
    service_amount = Column(Float, default=0.0)
    copay_amount = Column(Float, default=0.0)

    # Status
    status = Column(SAEnum(ClaimStatus), default=ClaimStatus.PENDING)
    is_flagged_c = Column(Boolean, default=False)
    flag_reason = Column(Text)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    batch = relationship("ClaimBatch", back_populates="claims")
    errors = relationship("PreScreenError", back_populates="claim", cascade="all, delete-orphan")


class ErrorSeverity(str, enum.Enum):
    ERROR = "ERROR"       # ข้อผิดพลาดร้ายแรง (ไม่ผ่าน)
    WARNING = "WARNING"   # คำเตือน (ควรแก้ไข)
    INFO = "INFO"         # ข้อมูลเพิ่มเติม


class PreScreenError(Base):
    """Pre-screen validation error for a claim record"""
    __tablename__ = "prescreen_errors"

    id = Column(Integer, primary_key=True, index=True)
    claim_id = Column(Integer, ForeignKey("claim_records.id"), nullable=False)
    error_code = Column(String(20), nullable=False)
    error_category = Column(String(50))   # ICD / DRUG / RIGHTS / DOC / DATE / DRG / C_FLAG
    error_field = Column(String(50))      # field name
    error_message = Column(Text, nullable=False)
    error_message_th = Column(Text)       # Thai message
    current_value = Column(String(500))
    expected_value = Column(String(500))
    severity = Column(SAEnum(ErrorSeverity), default=ErrorSeverity.ERROR)
    is_resolved = Column(Boolean, default=False)
    resolved_note = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    claim = relationship("ClaimRecord", back_populates="errors")


class ValidationRule(Base):
    """Custom validation rules"""
    __tablename__ = "validation_rules"

    id = Column(Integer, primary_key=True, index=True)
    rule_code = Column(String(50), unique=True)
    rule_name = Column(String(200))
    rule_name_th = Column(String(200))
    category = Column(String(50))
    claim_type = Column(SAEnum(ClaimType))  # NULL = applies to all
    condition_type = Column(String(50))     # ICD_REQUIRED / PRICE_LIMIT / ...
    condition_value = Column(Text)          # JSON config
    severity = Column(SAEnum(ErrorSeverity), default=ErrorSeverity.ERROR)
    is_active = Column(Boolean, default=True)
    description = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class DrugPriceRef(Base):
    """Drug reference price list"""
    __tablename__ = "drug_price_ref"

    id = Column(Integer, primary_key=True, index=True)
    drug_code = Column(String(50), unique=True, index=True)
    drug_name = Column(String(300))
    generic_name = Column(String(300))
    unit = Column(String(50))
    max_price = Column(Float)
    nhso_price = Column(Float)   # ราคา สปสช.
    is_active = Column(Boolean, default=True)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
