"""
ตรวจสอบ C-flag และเงื่อนไขการส่งเบิกสำหรับไฟล์ claim แต่ละกองทุน
"""
import re
from typing import Dict, List

from models import ClaimFundType

# ─── Issue structure ──────────────────────────────────────────────────────────
# issue = {"code": str, "field": str, "message": str, "severity": "ERROR"|"WARNING"}

ICD10_RE = re.compile(r"^[A-Z]\d{2,4}(\.\d{1,3})?$", re.IGNORECASE)
CID_RE = re.compile(r"^\d{13}$")

# รหัส ICD-10 ที่ห้ามเป็น PDX (symptom-only codes ที่ควรใช้ underlying disease)
SYMPTOM_ONLY_PDX = {
    "R00", "R01", "R02", "R03", "R04", "R05", "R06", "R07",
    "R09", "R10", "R11", "R50", "R51", "R52", "R53", "R55",
    "R60", "R69", "Z00",
}

# ─── Helpers ──────────────────────────────────────────────────────────────────

def _issue(code: str, field: str, message: str, severity: str = "ERROR") -> Dict:
    return {"code": code, "field": field, "message": message, "severity": severity}


def _is_valid_icd(code: str) -> bool:
    return bool(ICD10_RE.match(code.strip()))


def _is_valid_cid(cid: str) -> bool:
    cid = cid.strip()
    return CID_RE.match(cid) is not None


# ─── Common validators ────────────────────────────────────────────────────────

def _check_cid(rec: Dict) -> List[Dict]:
    issues = []
    cid = rec.get("cid", "").strip()
    if not cid:
        issues.append(_issue("CID001", "cid", "ไม่มีเลขบัตรประชาชน (CID)"))
    elif not _is_valid_cid(cid):
        issues.append(_issue("CID002", "cid", f"เลขบัตรประชาชนไม่ถูกต้อง: '{cid}' (ต้องเป็นตัวเลข 13 หลัก)"))
    return issues


def _check_pdx(rec: Dict) -> List[Dict]:
    issues = []
    pdx = rec.get("pdx", "").strip()
    if not pdx:
        issues.append(_issue("DX001", "pdx", "ไม่มีรหัส PDX (รหัสโรคหลัก)"))
    elif not _is_valid_icd(pdx):
        issues.append(_issue("DX002", "pdx", f"รหัส PDX '{pdx}' ไม่ใช่รูปแบบ ICD-10 ที่ถูกต้อง"))
    elif pdx[:3] in SYMPTOM_ONLY_PDX:
        issues.append(_issue("DX003", "pdx",
                             f"รหัส PDX '{pdx}' เป็น symptom code ควรใช้ specific diagnosis แทน",
                             "WARNING"))
    return issues


def _check_visit_date(rec: Dict) -> List[Dict]:
    issues = []
    vdate = rec.get("visit_date", rec.get("datetime", "")).strip()
    if not vdate:
        issues.append(_issue("DT001", "visit_date", "ไม่มีวันที่รับบริการ"))
    return issues


def _check_amount(rec: Dict) -> List[Dict]:
    issues = []
    total = rec.get("total_charge", 0.0)
    if total <= 0:
        issues.append(_issue("AMT001", "total_charge", "ยอดค่าใช้จ่ายรวมเป็น 0 หรือลบ"))
    return issues


# ─── SSS / CSMBS OPD validators ───────────────────────────────────────────────

def _validate_chi_opd_record(rec: Dict, fund_type: ClaimFundType) -> List[Dict]:
    issues = []

    # CID
    issues += _check_cid(rec)

    # Status C = already flagged by CHI system
    status = rec.get("status", "").strip()
    if status.upper() == "C":
        issues.append(_issue("CF001", "status",
                             "ไฟล์ติด C จาก CHI export แล้ว (status=C)"))

    # Visit date
    issues += _check_visit_date(rec)

    # Amount
    issues += _check_amount(rec)

    # Copay check: SSS OPD ควรเป็น 50 บาท
    copay = rec.get("copay", 0.0)
    if fund_type == ClaimFundType.SSS_OPD and copay > 0 and abs(copay - 50.0) > 0.01:
        issues.append(_issue("CP001", "copay",
                             f"copay = {copay:.2f} บาท (SSS OPD ปกติ = 50 บาท)",
                             "WARNING"))

    # Amount cross-check
    items = rec.get("bill_items", [])
    if items:
        items_total = sum(i.get("total", 0.0) for i in items)
        diff = abs(items_total - rec.get("total_charge", 0.0))
        if diff > 1.0:
            issues.append(_issue("AMT002", "total_charge",
                                 f"ยอดรวม {rec.get('total_charge', 0.0):.2f} ไม่ตรงกับผลรวม BillItems {items_total:.2f} (ต่างกัน {diff:.2f})",
                                 "WARNING"))

    # Drug items with code XXXXXX (ไม่มีรหัส TMT)
    drug_items = [i for i in items if i.get("svc_type") == "3"]
    for item in drug_items:
        svc_code = item.get("svc_code", "").strip()
        tmt_code = item.get("tmt_code", "").strip()
        if svc_code.upper() == "XXXXXX" or not tmt_code:
            issues.append(_issue("DRG001", "svc_code",
                                 f"ยา '{item.get('svc_name', '')}' ไม่มีรหัส TMT (svc_code={svc_code})",
                                 "WARNING"))

    return issues


# ─── AIPN IPD validators ──────────────────────────────────────────────────────

def _validate_aipn_record(rec: Dict) -> List[Dict]:
    issues = []

    # CID
    issues += _check_cid(rec)

    # PDX
    issues += _check_pdx(rec)

    # Admit/discharge date
    admit = rec.get("admit_date", "").strip()
    discharge = rec.get("discharge_date", "").strip()
    if not admit:
        issues.append(_issue("DT001", "admit_date", "ไม่มีวันที่รับไว้ (admit_date)"))
    if not discharge:
        issues.append(_issue("DT002", "discharge_date", "ไม่มีวันที่จำหน่าย (discharge_date)"))
    if admit and discharge and admit > discharge:
        issues.append(_issue("DT003", "discharge_date", "วันจำหน่ายก่อนวันรับไว้ (discharge < admit)"))

    # LOS
    los = rec.get("los", 0)
    if los < 1:
        issues.append(_issue("LOS001", "los", f"LOS = {los} วัน (ต้องมากกว่า 0 สำหรับ IPD)"))

    # Amount
    issues += _check_amount(rec)

    # Diagnoses – ควรมีอย่างน้อย 1 รายการ
    dx_list = rec.get("dx_list", [])
    if not dx_list:
        issues.append(_issue("DX004", "dx_list", "ไม่มีรหัสโรค (dx_list ว่าง)"))
    else:
        for dx in dx_list:
            icd = dx.get("icd", "").strip()
            if icd and not _is_valid_icd(icd):
                issues.append(_issue("DX005", "dx_list",
                                     f"รหัสโรค '{icd}' ไม่ใช่รูปแบบ ICD-10 ที่ถูกต้อง",
                                     "WARNING"))

    # Drug items with code XXXXXX
    for item in rec.get("bill_items", []):
        svc_code = item.get("svc_code", "").strip()
        if svc_code.upper() == "XXXXXX":
            issues.append(_issue("DRG001", "svc_code",
                                 f"ยา '{item.get('svc_name', '')}' ไม่มีรหัส (XXXXXX)",
                                 "WARNING"))

    return issues


# ─── Eclaim LGO validators ────────────────────────────────────────────────────

def _validate_eclaim_record(rec: Dict) -> List[Dict]:
    issues = []

    # CID
    issues += _check_cid(rec)

    # PDX
    issues += _check_pdx(rec)

    # Visit date
    issues += _check_visit_date(rec)

    # Amount
    issues += _check_amount(rec)

    # Diagnoses cross-check
    dx_list = rec.get("dx_list", [])
    if not dx_list:
        issues.append(_issue("DX004", "dx_list", "ไม่มีรหัสโรคใน IDX file สำหรับ visit นี้"))
    else:
        pdx_items = [d for d in dx_list if d.get("type") == "1"]
        if not pdx_items:
            issues.append(_issue("DX001", "pdx", "ไม่มีรหัส PDX (diag_type=1) ใน IDX file"))

        for dx in dx_list:
            icd = dx.get("icd", "").strip()
            if icd and not _is_valid_icd(icd):
                issues.append(_issue("DX005", "dx_list",
                                     f"รหัสโรค '{icd}' ไม่ใช่รูปแบบ ICD-10 ที่ถูกต้อง",
                                     "WARNING"))

    # Copay = C1 ควรมี
    cha_items = rec.get("cha_items", [])
    copay_items = [c for c in cha_items if c.get("charge_type") == "C1"]
    if not copay_items and rec.get("total_charge", 0) > 0:
        issues.append(_issue("CP002", "copay",
                             "ไม่มีรายการ copay (C1) ใน CHA file", "WARNING"))

    # ADP items – ตรวจ item_code XXXXXX
    for item in rec.get("adp_items", []):
        code = item.get("item_code", "").strip().upper()
        if code == "XXXXXX" or code == "":
            issues.append(_issue("DRG001", "item_code",
                                 "รายการค่าใช้จ่ายไม่มีรหัส (XXXXXX หรือว่าง)",
                                 "WARNING"))

    return issues


# ─── Main ──────────────────────────────────────────────────────────────────────

def validate_claim_records(records: List[Dict], fund_type: ClaimFundType) -> List[Dict]:
    """
    รัน validation สำหรับทุก record แล้ว return records พร้อม issues
    """
    for rec in records:
        if fund_type in (ClaimFundType.SSS_OPD, ClaimFundType.CSMBS_OPD):
            issues = _validate_chi_opd_record(rec, fund_type)
        elif fund_type == ClaimFundType.SSS_IPD:
            issues = _validate_aipn_record(rec)
        elif fund_type == ClaimFundType.LGO:
            issues = _validate_eclaim_record(rec)
        else:
            issues = []

        rec["issues"] = issues
        rec["has_error"] = any(i["severity"] == "ERROR" for i in issues)
        rec["has_warning"] = any(i["severity"] == "WARNING" for i in issues)

    return records
