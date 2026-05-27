"""
Excel / CSV parser for claim data ingestion.
Supports multiple column naming conventions used in Thai hospital systems.
"""
import pandas as pd
import numpy as np
from typing import Optional
import re
import io


# Column mapping: many possible header names → canonical field name
COLUMN_MAP = {
    "hn": ["hn", "patient_id", "รหัสผู้ป่วย", "เลข hn", "hospital_number"],
    "pid": ["pid", "cid", "เลขบัตรประชาชน", "citizen_id", "id_card"],
    "patient_name": ["ชื่อ-นามสกุล", "patient_name", "name", "fullname", "ชื่อผู้ป่วย"],
    "dob": ["วันเกิด", "dob", "date_of_birth", "birthdate"],
    "age": ["อายุ", "age"],
    "visit_date": ["วันที่รักษา", "visit_date", "date_admit", "admission_date", "วันนอน"],
    "discharge_date": ["วันจำหน่าย", "discharge_date", "ddate", "date_discharge"],
    "visit_type": ["ประเภท", "visit_type", "opd_ipd", "type"],
    "los": ["จำนวนวันนอน", "los", "length_of_stay", "day_admit"],
    "ward": ["ward", "หอผู้ป่วย", "ward_name"],
    "claim_type": ["สิทธิ์", "claim_type", "right_type", "rights", "สิทธิการรักษา"],
    "claim_no": ["เลขที่เบิก", "claim_no", "invoice_no", "claim_number"],
    "insurance_id": ["เลขสิทธิ์", "insurance_id", "member_id", "policy_no"],
    "pdx": ["pdx", "diag_main", "principal_dx", "รหัสโรคหลัก", "icd_pdx"],
    "adx1": ["adx1", "adx_1", "diag_sec1", "รหัสโรครอง1"],
    "adx2": ["adx2", "adx_2", "diag_sec2", "รหัสโรครอง2"],
    "adx3": ["adx3", "adx_3", "diag_sec3"],
    "adx4": ["adx4", "adx_4", "diag_sec4"],
    "op1": ["op1", "proc1", "procedure1", "icd9_1", "รหัสหัตถการ1"],
    "op2": ["op2", "proc2", "procedure2", "icd9_2"],
    "op3": ["op3", "proc3", "procedure3", "icd9_3"],
    "drg_code": ["drg", "drg_code", "drg_no", "รหัส drg"],
    "rw": ["rw", "relative_weight", "น้ำหนักสัมพัทธ์"],
    "adjrw": ["adjrw", "adj_rw", "adjusted_rw"],
    "total_charge": ["total_charge", "ค่ารักษาพยาบาลรวม", "total_cost", "ยอดรวม"],
    "claim_amount": ["claim_amount", "ยอดเบิก", "amount_claim", "claim_cost"],
    "drug_amount": ["drug_amount", "ค่ายา", "drug_cost"],
    "supply_amount": ["supply_amount", "ค่าเวชภัณฑ์", "supply_cost"],
    "service_amount": ["service_amount", "ค่าบริการ", "service_cost"],
    "copay_amount": ["copay_amount", "ค่าร่วมจ่าย", "copay", "patient_pay"],
}


def normalize_header(col: str) -> str:
    return str(col).strip().lower().replace(" ", "_").replace("-", "_")


def map_columns(df: pd.DataFrame) -> dict:
    """Return mapping: canonical_field → actual_column_name_in_df"""
    normalized = {normalize_header(c): c for c in df.columns}
    result = {}
    for field, aliases in COLUMN_MAP.items():
        for alias in aliases:
            norm = normalize_header(alias)
            if norm in normalized:
                result[field] = normalized[norm]
                break
    return result


def safe_str(val) -> Optional[str]:
    if val is None or (isinstance(val, float) and np.isnan(val)):
        return None
    return str(val).strip() if str(val).strip() else None


def safe_float(val) -> Optional[float]:
    try:
        if val is None or (isinstance(val, float) and np.isnan(val)):
            return None
        return float(val)
    except (ValueError, TypeError):
        return None


def safe_int(val) -> Optional[int]:
    try:
        if val is None or (isinstance(val, float) and np.isnan(val)):
            return None
        return int(float(val))
    except (ValueError, TypeError):
        return None


def parse_excel_to_records(file_bytes: bytes, filename: str) -> list[dict]:
    """Parse Excel or CSV file bytes → list of record dicts"""
    if filename.lower().endswith(".csv"):
        try:
            df = pd.read_csv(io.BytesIO(file_bytes), encoding="utf-8-sig", dtype=str)
        except UnicodeDecodeError:
            df = pd.read_csv(io.BytesIO(file_bytes), encoding="tis-620", dtype=str)
    else:
        df = pd.read_excel(io.BytesIO(file_bytes), dtype=str)

    df.columns = [str(c).strip() for c in df.columns]
    df = df.where(pd.notnull(df), None)

    col_map = map_columns(df)
    records = []

    for idx, row in df.iterrows():
        def get(field):
            col = col_map.get(field)
            return row[col] if col else None

        record = {
            "row_number": idx + 2,  # 1-based + header row
            "hn": safe_str(get("hn")),
            "pid": safe_str(get("pid")),
            "patient_name": safe_str(get("patient_name")),
            "dob": safe_str(get("dob")),
            "age": safe_int(get("age")),
            "visit_date": safe_str(get("visit_date")),
            "discharge_date": safe_str(get("discharge_date")),
            "visit_type": safe_str(get("visit_type")),
            "los": safe_int(get("los")),
            "ward": safe_str(get("ward")),
            "claim_type": safe_str(get("claim_type")),
            "claim_no": safe_str(get("claim_no")),
            "insurance_id": safe_str(get("insurance_id")),
            "pdx": safe_str(get("pdx")),
            "adx1": safe_str(get("adx1")),
            "adx2": safe_str(get("adx2")),
            "adx3": safe_str(get("adx3")),
            "adx4": safe_str(get("adx4")),
            "op1": safe_str(get("op1")),
            "op2": safe_str(get("op2")),
            "op3": safe_str(get("op3")),
            "drg_code": safe_str(get("drg_code")),
            "rw": safe_float(get("rw")),
            "adjrw": safe_float(get("adjrw")),
            "total_charge": safe_float(get("total_charge")) or 0.0,
            "claim_amount": safe_float(get("claim_amount")) or 0.0,
            "drug_amount": safe_float(get("drug_amount")) or 0.0,
            "supply_amount": safe_float(get("supply_amount")) or 0.0,
            "service_amount": safe_float(get("service_amount")) or 0.0,
            "copay_amount": safe_float(get("copay_amount")) or 0.0,
        }
        records.append(record)

    return records
