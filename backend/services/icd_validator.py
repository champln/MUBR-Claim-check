"""
ICD-10 / ICD-9-CM code validator
"""
import re


# ICD-10 pattern: Letter + 2 digits, optional dot, optional 1-2 digits
ICD10_PATTERN = re.compile(r"^[A-Za-z]\d{2}(\.\d{1,2})?$")
# ICD-10 with no dot (raw): A00, B012, etc.
ICD10_RAW_PATTERN = re.compile(r"^[A-Za-z]\d{2,4}$")
# ICD-9-CM: 2-3 digits, optional dot + 1-2 digits (procedure)
ICD9_PATTERN = re.compile(r"^\d{2,3}(\.\d{1,2})?$")

# ICD-10 chapters that are ALWAYS required to have secondary diagnoses
REQUIRES_SECONDARY = {"Z", "V", "W", "X", "Y"}

# C-flag triggers: ICD-10 codes that are frequently flagged
C_FLAG_CODES = {
    "Z511", "Z512",  # แพทย์รักษาโรคมะเร็ง
    "Z530",          # ยกเลิกการผ่าตัด
    "Z218",          # Asympt HIV
    "Z03",           # Observation without dx
}

# Codes that cannot be PDX (principal diagnosis)
INVALID_PDX_PREFIXES = {"Z00", "Z01", "Z02", "Z04", "Z10", "Z13"}


def validate_icd10(code: str) -> tuple[bool, str]:
    """Returns (is_valid, reason)"""
    if not code:
        return False, "รหัสว่าง"
    code = code.strip().upper()
    if ICD10_PATTERN.match(code) or ICD10_RAW_PATTERN.match(code):
        return True, ""
    return False, f"รูปแบบรหัส ICD-10 ไม่ถูกต้อง: {code}"


def validate_icd9(code: str) -> tuple[bool, str]:
    """Returns (is_valid, reason)"""
    if not code:
        return False, "รหัสว่าง"
    code = code.strip()
    if ICD9_PATTERN.match(code):
        return True, ""
    return False, f"รูปแบบรหัส ICD-9 ไม่ถูกต้อง: {code}"


def check_pdx_validity(pdx: str) -> tuple[bool, str]:
    """Check if PDX is valid as a principal diagnosis"""
    if not pdx:
        return False, "ไม่มีรหัสวินิจฉัยหลัก (PDX)"
    pdx = pdx.strip().upper()
    for prefix in INVALID_PDX_PREFIXES:
        if pdx.startswith(prefix):
            return False, f"รหัส {pdx} ไม่สามารถใช้เป็นวินิจฉัยหลักได้"
    return True, ""


def check_c_flag(pdx: str, adx_list: list[str]) -> tuple[bool, str]:
    """Check if claim should be flagged with C"""
    all_codes = [c.strip().upper() for c in [pdx] + adx_list if c]
    for code in all_codes:
        clean = code.replace(".", "")
        for trigger in C_FLAG_CODES:
            if clean.startswith(trigger):
                return True, f"พบรหัส {code} ที่อาจทำให้ติด C"
    return False, ""


def requires_additional_dx(pdx: str) -> bool:
    """Check if PDX prefix requires secondary diagnosis"""
    if not pdx:
        return False
    return pdx.strip()[0].upper() in REQUIRES_SECONDARY
