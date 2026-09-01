"""
ตัว parse ไฟล์ส่งเบิกแต่ละกองทุน
รองรับ:
  - SSS/CSMBS OPD: CHI XML (BILLTRAN*.txt, BILLDISP*.txt, OPServices*.txt)
  - SSS IPD:       AIPN XML (AIPN*.xml)
  - Eclaim LGO:   Pipe-delimited TXT (IDX, CHT, ADP, CHA, DRU ...)
"""
import json
import re
from typing import Dict, List, Optional, Tuple
import xml.etree.ElementTree as ET

from models import ClaimFundType


# ─── helpers ──────────────────────────────────────────────────────────────────

def _f(v: str) -> float:
    """Parse float safely, returns 0.0 on failure."""
    try:
        return float(v.replace(",", "").strip())
    except Exception:
        return 0.0


def _cols(line: str, n: int) -> List[str]:
    """Split pipe-delimited line and pad to at least n elements."""
    parts = line.split("|")
    while len(parts) < n:
        parts.append("")
    return parts


def _decode(data: bytes) -> str:
    """Try windows-874 first, fallback to utf-8."""
    for enc in ("windows-874", "cp874", "utf-8-sig", "utf-8"):
        try:
            return data.decode(enc)
        except Exception:
            continue
    return data.decode("utf-8", errors="replace")


# ─── Auto-detect fund type ─────────────────────────────────────────────────────

def detect_fund_type(filenames: List[str]) -> ClaimFundType:
    """
    ตรวจสอบประเภทกองทุนจากชื่อไฟล์ที่อัปโหลด
    """
    names_upper = [f.upper() for f in filenames]
    # AIPN IPD
    if any("AIPN" in n for n in names_upper):
        return ClaimFundType.SSS_IPD
    # Eclaim LGO
    if any(n.startswith("IDX") or n.startswith("CHT") or n.startswith("ADP") for n in names_upper):
        return ClaimFundType.LGO
    # CHI XML OPD
    if any("BILLTRAN" in n for n in names_upper):
        # Distinguish SS vs CS from first file content - caller passes raw bytes if needed
        return ClaimFundType.SSS_OPD  # default; refined after content parse
    return ClaimFundType.OTHER


def detect_fund_type_from_content(filenames: List[str], contents: Dict[str, bytes]) -> ClaimFundType:
    """
    ตรวจสอบประเภทกองทุนจากชื่อไฟล์และเนื้อหาจริง
    """
    names_upper = [f.upper() for f in filenames]

    if any("AIPN" in n for n in names_upper):
        return ClaimFundType.SSS_IPD

    if any(n.startswith("IDX") or n.startswith("CHT") or n.startswith("ADP") for n in names_upper):
        return ClaimFundType.LGO

    if any("BILLTRAN" in n for n in names_upper):
        # Read PayPlan from XML
        for fname, raw in contents.items():
            if "BILLTRAN" in fname.upper():
                text = _decode(raw)
                if 'PayPlan="CS"' in text or "PayPlan='CS'" in text:
                    return ClaimFundType.CSMBS_OPD
                if 'PayPlan="SS"' in text or "PayPlan='SS'" in text:
                    return ClaimFundType.SSS_OPD
        return ClaimFundType.SSS_OPD

    return ClaimFundType.OTHER


# ─── SSS / CSMBS OPD  (CHI XML) ───────────────────────────────────────────────

def parse_chi_opd(contents: Dict[str, bytes]) -> Tuple[List[Dict], ClaimFundType]:
    """
    Parse ชุดไฟล์ CHI OPD:
      BILLTRAN*.txt  – รายการ visit + BillItems
      BILLDISP*.txt  – Dispensing (ยา)
      OPServices*.txt – หัตถการ/บริการ
    Returns (records_list, fund_type)
    """
    visits: Dict[str, Dict] = {}
    fund_type = ClaimFundType.SSS_OPD

    for fname, raw in contents.items():
        name_up = fname.upper()
        text = _decode(raw)

        if "BILLTRAN" in name_up:
            _parse_billtran_section(text, fname, visits)
            # Detect pay plan
            if 'PayPlan="CS"' in text:
                fund_type = ClaimFundType.CSMBS_OPD

        elif "BILLDISP" in name_up:
            _parse_dispensing_section(text, fname, visits)

        elif "OPSERVICES" in name_up:
            _parse_opservices_section(text, fname, visits)

    return list(visits.values()), fund_type


def _parse_billtran_section(text: str, source_file: str, visits: Dict):
    """Parse BILLTRAN XML text content."""
    # ลบ XML declaration (encoding) ออกก่อน parse เพราะ ET ไม่รู้จัก windows-874
    clean = re.sub(r'<\?xml[^?]*\?>', '', text, count=1).strip()
    try:
        root = ET.fromstring(clean)
    except ET.ParseError:
        clean = clean.lstrip("\ufeff")
        try:
            root = ET.fromstring(clean)
        except Exception:
            return

    pay_plan = root.get("PayPlan", "SS")

    billtran_el = root.find("BILLTRAN")
    if billtran_el is not None and billtran_el.text:
        for line in billtran_el.text.strip().splitlines():
            line = line.strip()
            if not line:
                continue
            p = _cols(line, 19)
            visit_no = p[4].strip()
            if not visit_no:
                continue
            visits[visit_no] = {
                "visit_no": visit_no,
                "version": p[0],
                "datetime": p[2],
                "hcode": p[3],
                "ref_no": p[5],
                "pid": p[6],
                "total_charge": _f(p[8]),
                "copay": _f(p[9]),
                "status": p[11].strip(),   # A = active, C = flagged
                "cid": p[12].strip(),
                "patient_name": p[13].strip(),
                "hmain": p[14].strip(),
                "pay_plan": pay_plan,
                "claim_amount": _f(p[16]),
                "paytype": p[17].strip(),
                "copay2": _f(p[18]) if len(p) > 18 else 0.0,
                "bill_items": [],
                "disp_items": [],
                "op_services": [],
                "source_file": source_file,
            }

    items_el = root.find("BillItems")
    if items_el is not None and items_el.text:
        for line in items_el.text.strip().splitlines():
            line = line.strip()
            if not line:
                continue
            p = _cols(line, 13)
            visit_no = p[0].strip()
            if visit_no in visits:
                visits[visit_no]["bill_items"].append({
                    "visit_no": visit_no,
                    "date": p[1],
                    "svc_type": p[2],      # G=general C=service 3=drug 7=lab 8=rad E=special
                    "svc_code": p[3],
                    "tmt_code": p[4],
                    "svc_name": p[5],
                    "qty": _f(p[6]),
                    "unit_price": _f(p[7]),
                    "total": _f(p[8]),
                    "copay": _f(p[9]),
                    "copay2": _f(p[10]),
                    "ref": p[11],
                    "ward": p[12],
                })


def _parse_dispensing_section(text: str, source_file: str, visits: Dict):
    """Parse BILLDISP XML text content."""
    clean = re.sub(r'<\?xml[^?]*\?>', '', text, count=1).strip()
    try:
        root = ET.fromstring(clean)
    except Exception:
        return

    disp_el = root.find("Dispensing")
    if disp_el is None or not disp_el.text:
        return

    for line in disp_el.text.strip().splitlines():
        line = line.strip()
        if not line:
            continue
        p = _cols(line, 13)
        visit_no = p[0].strip()
        if visit_no in visits:
            visits[visit_no]["disp_items"].append({
                "visit_no": visit_no,
                "date": p[1],
                "drug_code": p[2],
                "tmt_code": p[3],
                "drug_name": p[4],
                "qty": _f(p[5]),
                "unit_price": _f(p[6]),
                "total": _f(p[7]),
                "copay": _f(p[8]),
                "ref": p[9],
            })


def _parse_opservices_section(text: str, source_file: str, visits: Dict):
    """Parse OPServices XML text content."""
    clean = re.sub(r'<\?xml[^?]*\?>', '', text, count=1).strip()
    try:
        root = ET.fromstring(clean)
    except Exception:
        return

    svc_el = root.find("OPServices")
    if svc_el is None or not svc_el.text:
        return

    for line in svc_el.text.strip().splitlines():
        line = line.strip()
        if not line:
            continue
        p = _cols(line, 10)
        visit_no = p[0].strip()
        if visit_no in visits:
            visits[visit_no]["op_services"].append({
                "visit_no": visit_no,
                "date": p[1],
                "svc_code": p[2],
                "svc_name": p[3],
                "qty": _f(p[4]),
                "unit_price": _f(p[5]),
                "total": _f(p[6]),
                "icd": p[7],
                "diag_seq": p[8],
                "ref": p[9],
            })


# ─── AIPN IPD (SSS XML) ────────────────────────────────────────────────────────

def parse_aipn_ipd(contents: Dict[str, bytes]) -> List[Dict]:
    """
    Parse AIPN XML (SSS IPD) – ไฟล์ AIPN*.xml
    Returns list of visit records
    """
    records = []
    for fname, raw in contents.items():
        if "AIPN" not in fname.upper():
            continue
        text = _decode(raw)
        clean = re.sub(r'<\?xml[^?]*\?>', '', text, count=1).strip()
        try:
            root = ET.fromstring(clean)
        except Exception:
            continue

        # IPADT – visit header (pipe-delimited single-line text)
        ipadt_el = root.find("IPADT")
        visit = {}
        if ipadt_el is not None and ipadt_el.text:
            p = _cols(ipadt_el.text.strip(), 22)
            visit = {
                "visit_no": p[0].strip(),
                "hn": p[1].strip(),
                "cid": p[3].strip(),
                "prefix": p[4].strip(),
                "patient_name": f"{p[4].strip()} {p[5].strip()}".strip(),
                "dob": p[6].strip(),
                "sex": p[7].strip(),
                "right_code": p[8].strip(),
                "pay_plan": p[9].strip(),
                "admit_date": p[14].strip(),
                "discharge_date": p[15].strip(),
                "los": int(p[17]) if p[17].strip().isdigit() else 0,
                "ward": p[18].strip(),
                "total_charge": _f(p[19]),
                "paytype": p[20].strip(),
                "dx_list": [],
                "op_list": [],
                "bill_items": [],
                "source_file": fname,
                "status": "A",
            }
        if not visit:
            continue

        # IPDx – diagnoses
        ipdx_el = root.find("IPDx")
        if ipdx_el is not None and ipdx_el.text:
            for line in ipdx_el.text.strip().splitlines():
                line = line.strip()
                if not line:
                    continue
                p = _cols(line, 7)
                visit["dx_list"].append({
                    "seq": p[0],
                    "type": p[1],          # 1=PDX, 2=ADX, 5=เหตุ
                    "icd_sys": p[2],
                    "icd": p[3].strip(),
                    "description": p[4].strip(),
                    "doctor": p[5].strip(),
                    "date": p[6].strip(),
                })
            # Set PDX
            pdx_items = [d for d in visit["dx_list"] if d["type"] == "1"]
            visit["pdx"] = pdx_items[0]["icd"] if pdx_items else ""

        # IPOp – procedures
        ipop_el = root.find("IPOp")
        if ipop_el is not None and ipop_el.text:
            for line in ipop_el.text.strip().splitlines():
                line = line.strip()
                if not line:
                    continue
                p = _cols(line, 8)
                visit["op_list"].append({
                    "seq": p[0],
                    "icd_sys": p[1],
                    "code": p[2].strip(),
                    "doctor": p[4].strip(),
                    "from_dt": p[5].strip(),
                    "to_dt": p[6].strip(),
                    "ward": p[7].strip(),
                })

        # BillItems
        inv_el = root.find("Invoices")
        if inv_el is not None:
            inv_no_el = inv_el.find("InvNumber")
            visit["inv_number"] = inv_no_el.text.strip() if inv_no_el is not None and inv_no_el.text else ""
            items_el = inv_el.find("BillItems")
            if items_el is not None and items_el.text:
                for line in items_el.text.strip().splitlines():
                    line = line.strip()
                    if not line:
                        continue
                    p = _cols(line, 18)
                    visit["bill_items"].append({
                        "seq": p[0],
                        "date": p[1],
                        "svc_type": p[2],
                        "svc_code": p[3],
                        "svc_name": p[4],
                        "qty": _f(p[5]),
                        "unit_price": _f(p[6]),
                        "total": _f(p[7]),
                        "copay": _f(p[8]),
                        "paytype": p[11] if len(p) > 11 else "",
                        "tmt": p[13] if len(p) > 13 else "",
                        "tmt_no": p[14] if len(p) > 14 else "",
                        "flag": p[15] if len(p) > 15 else "",
                    })

        records.append(visit)
    return records


# ─── Eclaim LGO ───────────────────────────────────────────────────────────────

def parse_eclaim_lgo(contents: Dict[str, bytes]) -> List[Dict]:
    """
    Parse ชุดไฟล์ Eclaim LGO (pipe-delimited TXT):
      IDX*.txt  – รหัสโรค ICD-10 ต่อ visit
      CHT*.txt  – สรุปค่าใช้จ่ายต่อ visit
      ADP*.txt  – รายการค่าใช้จ่ายแต่ละรายการ
      CHA*.txt  – ค่าใช้จ่ายแยกประเภท
      DRU*.txt  – ยา
      INS*.txt  – ข้อมูลสิทธิ์
    Returns list of visit records
    """
    visits: Dict[str, Dict] = {}

    # 1) CHT – สรุปค่าใช้จ่ายต่อ visit (primary key)
    for fname, raw in contents.items():
        if not re.match(r"CHT", fname.upper().lstrip("/\\").split("/")[-1].split("\\")[-1]):
            continue
        text = _decode(raw)
        for line in text.strip().splitlines():
            line = line.strip()
            if not line:
                continue
            p = _cols(line, 8)
            hn = p[0].strip()
            visit_no = p[7].strip()  # seq_no = visit identifier
            if not visit_no:
                visit_no = p[1].strip()
            if not visit_no:
                continue  # skip records without any visit identifier
            visits[visit_no] = {
                "visit_no": visit_no,
                "hn": hn,
                "visit_date": p[2].strip(),
                "total_charge": _f(p[3]),
                "copay": _f(p[4]),
                "plan_type": p[5].strip(),
                "cid": p[6].strip(),
                "dx_list": [],
                "adp_items": [],
                "cha_items": [],
                "dru_items": [],
                "status": "A",
                "source_file": fname,
            }

    # 2) IDX – รหัสโรค
    for fname, raw in contents.items():
        if not re.match(r"IDX", fname.upper().lstrip("/\\").split("/")[-1].split("\\")[-1]):
            continue
        text = _decode(raw)
        for line in text.strip().splitlines():
            line = line.strip()
            if not line:
                continue
            p = _cols(line, 4)
            visit_no = p[0].strip()
            icd = p[1].strip()
            diag_type = p[2].strip()   # 1=PDX 2=ADX 5=เหตุ
            if visit_no in visits:
                visits[visit_no]["dx_list"].append({
                    "icd": icd,
                    "type": diag_type,
                    "ref": p[3].strip(),
                })
            # Ensure visit exists even if CHT is missing
            elif visit_no:
                if visit_no not in visits:
                    visits[visit_no] = {
                        "visit_no": visit_no,
                        "hn": "",
                        "visit_date": "",
                        "total_charge": 0.0,
                        "copay": 0.0,
                        "plan_type": "",
                        "cid": "",
                        "dx_list": [],
                        "adp_items": [],
                        "cha_items": [],
                        "dru_items": [],
                        "status": "A",
                        "source_file": fname,
                    }
                visits[visit_no]["dx_list"].append({"icd": icd, "type": diag_type, "ref": p[3].strip()})

    # Set PDX for each visit
    for v in visits.values():
        pdx_items = [d for d in v["dx_list"] if d["type"] == "1"]
        v["pdx"] = pdx_items[0]["icd"] if pdx_items else ""

    # 3) ADP – รายการค่าใช้จ่าย
    for fname, raw in contents.items():
        if not re.match(r"ADP", fname.upper().lstrip("/\\").split("/")[-1].split("\\")[-1]):
            continue
        text = _decode(raw)
        for line in text.strip().splitlines():
            line = line.strip()
            if not line:
                continue
            p = _cols(line, 24)
            visit_no = p[7].strip()
            if not visit_no:
                visit_no = p[1].strip()
            if visit_no in visits:
                visits[visit_no]["adp_items"].append({
                    "hn": p[0].strip(),
                    "visit_date": p[2].strip(),
                    "item_type": p[3].strip(),
                    "item_code": p[4].strip(),
                    "qty": _f(p[5]),
                    "unit_price": _f(p[6]),
                    "copay": _f(p[10]) if len(p) > 10 else 0.0,
                    "claim": _f(p[11]) if len(p) > 11 else 0.0,
                    "plan_type": p[16].strip() if len(p) > 16 else "",
                })

    # 4) CHA – ค่าใช้จ่ายแยกประเภท
    for fname, raw in contents.items():
        if not re.match(r"CHA", fname.upper().lstrip("/\\").split("/")[-1].split("\\")[-1]):
            continue
        text = _decode(raw)
        for line in text.strip().splitlines():
            line = line.strip()
            if not line:
                continue
            p = _cols(line, 7)
            visit_no = p[6].strip()
            if not visit_no:
                continue
            if visit_no in visits:
                visits[visit_no]["cha_items"].append({
                    "hn": p[0].strip(),
                    "date": p[2].strip(),
                    "charge_type": p[3].strip(),  # 41=ยา, 71=บริการ, C1=copay
                    "amount": _f(p[4]),
                    "cid": p[5].strip(),
                })

    # 5) DRU – รายการยา
    for fname, raw in contents.items():
        if not re.match(r"DRU", fname.upper().lstrip("/\\").split("/")[-1].split("\\")[-1]):
            continue
        text = _decode(raw)
        for line in text.strip().splitlines():
            line = line.strip()
            if not line:
                continue
            p = _cols(line, 12)
            visit_no = p[7].strip() if len(p) > 7 else p[1].strip()
            if visit_no in visits:
                visits[visit_no]["dru_items"].append({
                    "hn": p[0].strip(),
                    "date": p[2].strip(),
                    "drug_code": p[3].strip(),
                    "drug_name": p[4].strip(),
                    "qty": _f(p[5]),
                    "unit_price": _f(p[6]),
                    "total": _f(p[6]) * _f(p[5]),
                })

    return list(visits.values())


# ─── Main entry point ──────────────────────────────────────────────────────────

def parse_claim_files(contents: Dict[str, bytes]) -> Tuple[List[Dict], ClaimFundType]:
    """
    รับ dict ชื่อไฟล์ → bytes แล้ว return (records, fund_type)
    """
    filenames = list(contents.keys())
    fund_type = detect_fund_type_from_content(filenames, contents)

    if fund_type == ClaimFundType.SSS_IPD:
        records = parse_aipn_ipd(contents)
    elif fund_type == ClaimFundType.LGO:
        records = parse_eclaim_lgo(contents)
    elif fund_type in (ClaimFundType.SSS_OPD, ClaimFundType.CSMBS_OPD):
        records, fund_type = parse_chi_opd(contents)
    else:
        records = []

    return records, fund_type
