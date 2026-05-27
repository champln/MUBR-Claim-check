"""
Core pre-screen claim checker.
Runs all validation rules against a claim record and returns list of errors.
"""
from dataclasses import dataclass, field
from typing import Optional
from datetime import datetime, date
import re
from services.icd_validator import (
    validate_icd10, validate_icd9, check_pdx_validity,
    check_c_flag, requires_additional_dx
)


@dataclass
class CheckError:
    error_code: str
    error_category: str       # ICD / DRUG / RIGHTS / DOC / DATE / DRG / C_FLAG / AMOUNT
    error_field: str
    error_message: str
    error_message_th: str
    severity: str = "ERROR"   # ERROR / WARNING / INFO
    current_value: Optional[str] = None
    expected_value: Optional[str] = None


def run_prescreen(record: dict, custom_rules: list = None) -> tuple[list[CheckError], bool, str]:
    """
    Run all pre-screen checks on a claim record dict.
    Returns: (errors, is_flagged_c, flag_reason)
    """
    errors: list[CheckError] = []
    custom_rules = custom_rules or []

    # ── 1. Document Completeness ─────────────────────────────────────────────

    if not record.get("hn"):
        errors.append(CheckError(
            error_code="DOC001",
            error_category="DOC",
            error_field="hn",
            error_message="Missing HN (Hospital Number)",
            error_message_th="ไม่มีรหัส HN ผู้ป่วย",
            severity="ERROR",
        ))

    if not record.get("pid"):
        errors.append(CheckError(
            error_code="DOC002",
            error_category="DOC",
            error_field="pid",
            error_message="Missing patient ID / citizen ID",
            error_message_th="ไม่มีเลขบัตรประชาชน",
            severity="WARNING",
        ))
    elif record.get("pid") and not _validate_thai_pid(record["pid"]):
        errors.append(CheckError(
            error_code="DOC003",
            error_category="DOC",
            error_field="pid",
            error_message="Invalid Thai citizen ID (checksum failed)",
            error_message_th="เลขบัตรประชาชนไม่ถูกต้อง (checksum ไม่ผ่าน)",
            severity="WARNING",
            current_value=record.get("pid"),
        ))

    if not record.get("visit_date"):
        errors.append(CheckError(
            error_code="DOC004",
            error_category="DOC",
            error_field="visit_date",
            error_message="Missing visit/admission date",
            error_message_th="ไม่มีวันที่รับบริการ",
            severity="ERROR",
        ))

    if not record.get("claim_type"):
        errors.append(CheckError(
            error_code="DOC005",
            error_category="DOC",
            error_field="claim_type",
            error_message="Missing claim type / patient rights",
            error_message_th="ไม่มีสิทธิ์การรักษา",
            severity="ERROR",
        ))

    # ── 2. ICD-10 Validation ─────────────────────────────────────────────────

    pdx = record.get("pdx")
    if not pdx:
        errors.append(CheckError(
            error_code="ICD001",
            error_category="ICD",
            error_field="pdx",
            error_message="Missing Principal Diagnosis (PDX)",
            error_message_th="ไม่มีรหัสวินิจฉัยหลัก PDX",
            severity="ERROR",
        ))
    else:
        valid, reason = validate_icd10(pdx)
        if not valid:
            errors.append(CheckError(
                error_code="ICD002",
                error_category="ICD",
                error_field="pdx",
                error_message=f"Invalid ICD-10 PDX: {reason}",
                error_message_th=f"รหัส PDX ไม่ถูกต้อง: {reason}",
                severity="ERROR",
                current_value=pdx,
                expected_value="รูปแบบ A00.0 หรือ A000",
            ))

        valid_pdx, pdx_reason = check_pdx_validity(pdx)
        if not valid_pdx:
            errors.append(CheckError(
                error_code="ICD003",
                error_category="ICD",
                error_field="pdx",
                error_message=f"PDX not allowed as principal diagnosis",
                error_message_th=pdx_reason,
                severity="ERROR",
                current_value=pdx,
            ))

    # Check additional diagnoses
    adx_fields = ["adx1", "adx2", "adx3", "adx4"]
    adx_list = []
    for f in adx_fields:
        code = record.get(f)
        if code:
            adx_list.append(code)
            valid, reason = validate_icd10(code)
            if not valid:
                errors.append(CheckError(
                    error_code="ICD004",
                    error_category="ICD",
                    error_field=f,
                    error_message=f"Invalid ICD-10 {f.upper()}: {reason}",
                    error_message_th=f"รหัส {f.upper()} ไม่ถูกต้อง: {reason}",
                    severity="WARNING",
                    current_value=code,
                ))

    if pdx and requires_additional_dx(pdx) and not adx_list:
        errors.append(CheckError(
            error_code="ICD005",
            error_category="ICD",
            error_field="adx1",
            error_message=f"PDX {pdx} requires at least one additional diagnosis",
            error_message_th=f"รหัส PDX {pdx} ควรมีรหัสวินิจฉัยรองประกอบ",
            severity="WARNING",
            current_value=pdx,
        ))

    # Check procedures (ICD-9-CM)
    for f in ["op1", "op2", "op3"]:
        code = record.get(f)
        if code:
            valid, reason = validate_icd9(code)
            if not valid:
                # May be ICD-10-PCS — try ICD-10 format too
                valid10, _ = validate_icd10(code)
                if not valid10:
                    errors.append(CheckError(
                        error_code="ICD006",
                        error_category="ICD",
                        error_field=f,
                        error_message=f"Invalid procedure code {f.upper()}: {code}",
                        error_message_th=f"รหัสหัตถการ {f.upper()} ไม่ถูกต้อง: {code}",
                        severity="WARNING",
                        current_value=code,
                    ))

    # ── 3. C-Flag Check ───────────────────────────────────────────────────────

    is_flagged_c, flag_reason = check_c_flag(pdx or "", adx_list)
    if is_flagged_c:
        errors.append(CheckError(
            error_code="CFLAG001",
            error_category="C_FLAG",
            error_field="pdx",
            error_message="Claim may be flagged with C status",
            error_message_th=flag_reason,
            severity="ERROR",
            current_value=pdx,
        ))

    # ── 4. Date Validation ────────────────────────────────────────────────────

    visit_date = record.get("visit_date")
    discharge_date = record.get("discharge_date")
    visit_type = (record.get("visit_type") or "").upper()

    if visit_date and discharge_date:
        try:
            vd = _parse_date(visit_date)
            dd = _parse_date(discharge_date)
            if vd and dd:
                if dd < vd:
                    errors.append(CheckError(
                        error_code="DATE001",
                        error_category="DATE",
                        error_field="discharge_date",
                        error_message="Discharge date is before admission date",
                        error_message_th="วันจำหน่ายก่อนวันรับบริการ",
                        severity="ERROR",
                        current_value=discharge_date,
                        expected_value=f">= {visit_date}",
                    ))
                # Future date check
                today = date.today()
                if vd > today:
                    errors.append(CheckError(
                        error_code="DATE002",
                        error_category="DATE",
                        error_field="visit_date",
                        error_message="Visit date is in the future",
                        error_message_th="วันที่รับบริการเป็นวันในอนาคต",
                        severity="ERROR",
                        current_value=visit_date,
                    ))
        except Exception:
            pass

    # IPD must have discharge date and LOS
    if "IPD" in visit_type:
        if not discharge_date:
            errors.append(CheckError(
                error_code="DATE003",
                error_category="DATE",
                error_field="discharge_date",
                error_message="IPD claim missing discharge date",
                error_message_th="ผู้ป่วยใน (IPD) ไม่มีวันจำหน่าย",
                severity="ERROR",
            ))
        los = record.get("los")
        if los is None:
            errors.append(CheckError(
                error_code="DATE004",
                error_category="DATE",
                error_field="los",
                error_message="IPD claim missing Length of Stay",
                error_message_th="ผู้ป่วยใน (IPD) ไม่มีจำนวนวันนอน",
                severity="WARNING",
            ))
        elif los is not None and los > 365:
            errors.append(CheckError(
                error_code="DATE005",
                error_category="DATE",
                error_field="los",
                error_message=f"Unusually long LOS: {los} days",
                error_message_th=f"จำนวนวันนอนผิดปกติ: {los} วัน",
                severity="WARNING",
                current_value=str(los),
            ))

    # ── 5. Amount Validation ─────────────────────────────────────────────────

    total_charge = record.get("total_charge") or 0.0
    claim_amount = record.get("claim_amount") or 0.0
    drug_amount = record.get("drug_amount") or 0.0
    supply_amount = record.get("supply_amount") or 0.0
    service_amount = record.get("service_amount") or 0.0
    copay_amount = record.get("copay_amount") or 0.0

    if total_charge <= 0:
        errors.append(CheckError(
            error_code="AMT001",
            error_category="AMOUNT",
            error_field="total_charge",
            error_message="Total charge is zero or missing",
            error_message_th="ยอดค่ารักษาพยาบาลรวมเป็น 0 หรือไม่มีข้อมูล",
            severity="WARNING",
            current_value=str(total_charge),
        ))

    if claim_amount > total_charge:
        errors.append(CheckError(
            error_code="AMT002",
            error_category="AMOUNT",
            error_field="claim_amount",
            error_message="Claim amount exceeds total charge",
            error_message_th="ยอดเบิกมากกว่ายอดค่ารักษาพยาบาลรวม",
            severity="ERROR",
            current_value=str(claim_amount),
            expected_value=f"<= {total_charge}",
        ))

    # Sub-total check: parts should not exceed total
    sub_total = drug_amount + supply_amount + service_amount
    if sub_total > total_charge * 1.05:  # 5% tolerance
        errors.append(CheckError(
            error_code="AMT003",
            error_category="AMOUNT",
            error_field="total_charge",
            error_message="Sum of sub-totals exceeds total charge",
            error_message_th="ผลรวมรายการย่อยมากกว่ายอดรวม",
            severity="WARNING",
            current_value=str(sub_total),
            expected_value=f"<= {total_charge}",
        ))

    # ── 6. DRG Validation (IPD) ───────────────────────────────────────────────

    if "IPD" in visit_type:
        if not record.get("drg_code"):
            errors.append(CheckError(
                error_code="DRG001",
                error_category="DRG",
                error_field="drg_code",
                error_message="IPD claim missing DRG code",
                error_message_th="ผู้ป่วยใน (IPD) ไม่มีรหัส DRG",
                severity="WARNING",
            ))
        rw = record.get("rw")
        if rw is not None and rw <= 0:
            errors.append(CheckError(
                error_code="DRG002",
                error_category="DRG",
                error_field="rw",
                error_message="Relative Weight (RW) is zero or negative",
                error_message_th="ค่า RW เป็น 0 หรือติดลบ",
                severity="WARNING",
                current_value=str(rw),
            ))

    # ── 7. Rights / Claim Type Specific Rules ────────────────────────────────

    claim_type = (record.get("claim_type") or "").upper()

    if "SSO" in claim_type:
        if not record.get("insurance_id"):
            errors.append(CheckError(
                error_code="RIGHTS001",
                error_category="RIGHTS",
                error_field="insurance_id",
                error_message="SSO claim missing insurance member ID",
                error_message_th="ประกันสังคม (SSO) ไม่มีเลขที่สมาชิก",
                severity="ERROR",
            ))

    if "CSMBS" in claim_type or "ข้าราชการ" in claim_type:
        if not record.get("insurance_id"):
            errors.append(CheckError(
                error_code="RIGHTS002",
                error_category="RIGHTS",
                error_field="insurance_id",
                error_message="CSMBS claim missing government ID",
                error_message_th="สวัสดิการข้าราชการ ไม่มีเลขประจำตัว",
                severity="ERROR",
            ))

    # ── 8. Custom Rules ───────────────────────────────────────────────────────

    for rule in custom_rules:
        if not rule.get("is_active"):
            continue
        rule_errors = _apply_custom_rule(record, rule)
        errors.extend(rule_errors)

    return errors, is_flagged_c, flag_reason


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _validate_thai_pid(pid: str) -> bool:
    """Validate Thai citizen ID using Luhn-like checksum"""
    pid = re.sub(r"\D", "", str(pid))
    if len(pid) != 13:
        return False
    total = sum(int(pid[i]) * (13 - i) for i in range(12))
    check = (11 - (total % 11)) % 10
    return check == int(pid[12])


def _parse_date(s: str) -> Optional[date]:
    """Try to parse date string in multiple formats"""
    if not s:
        return None
    formats = ["%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y%m%d", "%d/%m/%y"]
    for fmt in formats:
        try:
            return datetime.strptime(str(s).strip(), fmt).date()
        except ValueError:
            continue
    return None


def _apply_custom_rule(record: dict, rule: dict) -> list[CheckError]:
    """Apply a single custom validation rule"""
    errors = []
    ctype = rule.get("condition_type", "")

    if ctype == "FIELD_REQUIRED":
        field = rule.get("condition_value", "")
        if not record.get(field):
            errors.append(CheckError(
                error_code=rule.get("rule_code", "CUSTOM"),
                error_category=rule.get("category", "CUSTOM"),
                error_field=field,
                error_message=rule.get("rule_name", "Custom rule failed"),
                error_message_th=rule.get("rule_name_th") or rule.get("rule_name", ""),
                severity=rule.get("severity", "WARNING"),
            ))
    elif ctype == "AMOUNT_LIMIT":
        import json
        try:
            cfg = json.loads(rule.get("condition_value", "{}"))
            field = cfg.get("field", "claim_amount")
            limit = float(cfg.get("max", 0))
            val = float(record.get(field) or 0)
            if val > limit:
                errors.append(CheckError(
                    error_code=rule.get("rule_code", "CUSTOM"),
                    error_category=rule.get("category", "AMOUNT"),
                    error_field=field,
                    error_message=rule.get("rule_name", f"{field} exceeds limit"),
                    error_message_th=rule.get("rule_name_th") or rule.get("rule_name", ""),
                    severity=rule.get("severity", "WARNING"),
                    current_value=str(val),
                    expected_value=f"<= {limit}",
                ))
        except Exception:
            pass

    return errors
