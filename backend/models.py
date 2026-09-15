from sqlalchemy import (
    Column, Integer, String, Float, DateTime, Boolean,
    Text, ForeignKey, LargeBinary, Enum as SAEnum
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


class UserRole(str, enum.Enum):
    ADMIN = "ADMIN"
    REVIEWER = "REVIEWER"
    OPERATOR = "OPERATOR"


class UserSource(str, enum.Enum):
    LOCAL = "LOCAL"
    HOSXP = "HOSXP"


class User(Base):
    """Application user for authentication and role-based access control"""
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(100), unique=True, nullable=False, index=True)
    full_name = Column(String(200))
    password_hash = Column(String(255), nullable=False)
    source = Column(SAEnum(UserSource), nullable=False, default=UserSource.LOCAL)
    external_ref = Column(String(100), nullable=True, index=True)
    role = Column(SAEnum(UserRole), nullable=False, default=UserRole.OPERATOR)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class HosxpUserSelection(Base):
    """Admin-selected users from HOSxP to be allowed in this app"""
    __tablename__ = "hosxp_user_selections"

    id = Column(Integer, primary_key=True, index=True)
    hosxp_username = Column(String(100), unique=True, nullable=False, index=True)
    full_name = Column(String(200))
    role = Column(SAEnum(UserRole), nullable=False, default=UserRole.OPERATOR)
    is_active = Column(Boolean, default=True)
    selected_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    selected_at = Column(DateTime(timezone=True), server_default=func.now())
    last_synced_at = Column(DateTime(timezone=True), nullable=True)


class HosxpConnectionConfig(Base):
    """Connection and mapping config for HOSxP user lookup"""
    __tablename__ = "hosxp_connection_config"

    id = Column(Integer, primary_key=True, index=True)
    db_url = Column(Text, nullable=False)
    user_table = Column(String(100), nullable=True)
    username_column = Column(String(100), nullable=True)
    full_name_column = Column(String(100), nullable=True)
    active_column = Column(String(100), nullable=True)
    password_column = Column(String(100), nullable=True)   # คอลัมน์รหัสผ่านใน HOSxP (เช่น password/passwd)
    auth_method = Column(String(30), nullable=True)         # วิธียืนยัน: MD5/SHA1/PLAIN/MYSQL_PASSWORD/MYSQL_ENCRYPT
    is_enabled = Column(Boolean, default=True)
    updated_by_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class UserAuditLog(Base):
    """Audit log for user and access control changes"""
    __tablename__ = "user_audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    actor_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    target_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    action = Column(String(100), nullable=False)
    detail = Column(Text)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class LoginAuditLog(Base):
    """Authentication event log (success/failure)"""
    __tablename__ = "login_audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(100), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    success = Column(Boolean, nullable=False, default=False)
    ip_address = Column(String(100), nullable=True)
    user_agent = Column(Text, nullable=True)
    reason = Column(String(100), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


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


# ─── Claim File Check ──────────────────────────────────────────────────────────

class ClaimFundType(str, enum.Enum):
    SSS_OPD = "SSS_OPD"       # ประกันสังคม ผู้ป่วยนอก (CHI XML)
    SSS_IPD = "SSS_IPD"       # ประกันสังคม ผู้ป่วยใน (AIPN XML)
    CSMBS_OPD = "CSMBS_OPD"   # สวัสดิการข้าราชการ ผู้ป่วยนอก (CHI XML)
    CSMBS_IPD = "CSMBS_IPD"   # สวัสดิการข้าราชการ ผู้ป่วยใน
    LGO = "LGO"               # องค์การปกครองส่วนท้องถิ่น (Eclaim)
    OTHER = "OTHER"


class ClaimFileSessionStatus(str, enum.Enum):
    PROCESSING = "PROCESSING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class ClaimFileSession(Base):
    """Session สำหรับตรวจสอบไฟล์ส่งเบิก"""
    __tablename__ = "claim_file_sessions"

    id = Column(Integer, primary_key=True, index=True)
    session_name = Column(String(255), nullable=False)
    fund_type = Column(SAEnum(ClaimFundType), nullable=False)
    period_month = Column(Integer, nullable=True)
    period_year = Column(Integer, nullable=True)
    files_info = Column(Text)       # JSON: list of uploaded filenames
    total_records = Column(Integer, default=0)
    error_count = Column(Integer, default=0)
    warning_count = Column(Integer, default=0)
    status = Column(SAEnum(ClaimFileSessionStatus), default=ClaimFileSessionStatus.PROCESSING)
    uploaded_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # ไฟล์ต้นฉบับที่อัปโหลด (zip) — เก็บไว้เพื่อแก้ไขระดับฟิลด์แล้วเซ็น Checksum ใหม่
    source_zip = Column(LargeBinary)
    source_filename = Column(String(255))
    raw_edits = Column(Text)        # JSON: [{file, section, row, field, value}]

    records = relationship("ClaimFileRecord", back_populates="session", cascade="all, delete-orphan")


class ClaimFileRecord(Base):
    """Record แต่ละ visit จากไฟล์ส่งเบิก"""
    __tablename__ = "claim_file_records"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("claim_file_sessions.id"), nullable=False, index=True)

    visit_no = Column(String(50), index=True)
    hn = Column(String(50))
    cid = Column(String(20))        # เลขบัตรประชาชน 13 หลัก
    patient_name = Column(String(200))
    visit_date = Column(String(20))
    discharge_date = Column(String(20))
    pdx = Column(String(20))        # รหัส PDX (ICD-10)
    total_charge = Column(Float, default=0.0)
    claim_amount = Column(Float, default=0.0)
    copay_amount = Column(Float, default=0.0)

    raw_data = Column(Text)         # JSON: ข้อมูลทั้งหมดของ record นี้
    issues = Column(Text)           # JSON: [{code, field, message, severity}]

    has_error = Column(Boolean, default=False)
    has_warning = Column(Boolean, default=False)
    is_edited = Column(Boolean, default=False)
    edited_data = Column(Text)      # JSON: ข้อมูลหลังแก้ไข

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    session = relationship("ClaimFileSession", back_populates="records")


# ─── CPAP Fix History ──────────────────────────────────────────────────────────

class CpapFixSession(Base):
    """ประวัติการแก้ไฟล์ส่งเบิก CPAP/sleep test แต่ละครั้ง (เก็บไฟล์ผลลัพธ์ไว้โหลดซ้ำ)"""
    __tablename__ = "cpap_fix_sessions"

    id = Column(Integer, primary_key=True, index=True)
    session_name = Column(String(255), nullable=False)
    fiscal_year = Column(Integer, index=True)       # ปีงบประมาณ (พ.ศ.) เช่น 2569
    claim_types = Column(String(50), index=True)    # "CPAP" / "PSG" / "CPAP,PSG"
    pay_plan = Column(String(10))                   # CS
    service_date = Column(String(20))               # วันรับบริการตัวแทน (YYYY-MM-DD)
    visit_count = Column(Integer, default=0)
    file_count = Column(Integer, default=0)

    auth_codes = Column(Text)        # JSON: {visit_no: รหัสอนุมัติ}
    changes = Column(Text)           # JSON: list ของสิ่งที่แก้
    visits_info = Column(Text)       # JSON: snapshot visit ที่แก้ (สำหรับดูย้อนหลัง)
    files_info = Column(Text)        # JSON: list ชื่อไฟล์

    result_zip = Column(LargeBinary) # ไฟล์ zip ที่แก้แล้ว (โหลดซ้ำได้)
    result_filename = Column(String(255), default="cpap_fixed.zip")

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)


class StdCodeMapping(Base):
    """
    คลังรหัสหัตถการ: รหัสบริการของ รพ. (LocalCode) -> รหัสมาตรฐาน (STDCode)
    ใช้เติม/แก้ STDCode ในแฟ้ม OPServices เพื่อกัน C รหัส S19 และ S41
    """
    __tablename__ = "stdcode_mappings"

    id = Column(Integer, primary_key=True, index=True)
    local_code = Column(String(50), unique=True, index=True, nullable=False)
    std_code = Column(String(50), nullable=False)
    description = Column(String(255))     # ชื่อรายการ (ไว้ให้คนอ่านออก)
    source = Column(String(30), default="MANUAL")  # MANUAL / LEARNED (เรียนรู้จากไฟล์)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    updated_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
