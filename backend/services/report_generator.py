"""
Report generator — exports pre-screen results to Excel.
"""
import io
import pandas as pd
from sqlalchemy.orm import Session
from models import ClaimRecord, PreScreenError, ClaimBatch


def generate_excel_report(db: Session, batch_id: int) -> bytes:
    """Generate Excel report for a batch — summary + errors sheet"""

    batch = db.query(ClaimBatch).filter(ClaimBatch.id == batch_id).first()
    if not batch:
        raise ValueError(f"Batch {batch_id} not found")

    claims = (
        db.query(ClaimRecord)
        .filter(ClaimRecord.batch_id == batch_id)
        .all()
    )

    # ── Sheet 1: All claims with status ──────────────────────────────────────
    rows = []
    for c in claims:
        error_codes = ", ".join(e.error_code for e in c.errors if e.severity == "ERROR")
        warn_codes = ", ".join(e.error_code for e in c.errors if e.severity == "WARNING")
        rows.append({
            "แถวที่": c.row_number,
            "HN": c.hn,
            "เลขบัตรประชาชน": c.pid,
            "ชื่อผู้ป่วย": c.patient_name,
            "วันที่รักษา": c.visit_date,
            "วันจำหน่าย": c.discharge_date,
            "ประเภท": c.visit_type,
            "สิทธิ์": c.claim_type.value if c.claim_type else "",
            "PDX": c.pdx,
            "ADX1": c.adx1,
            "DRG": c.drg_code,
            "RW": c.rw,
            "ยอดรวม": c.total_charge,
            "ยอดเบิก": c.claim_amount,
            "สถานะ": c.status.value,
            "ติด C": "ใช่" if c.is_flagged_c else "",
            "รหัสข้อผิดพลาด": error_codes,
            "รหัสคำเตือน": warn_codes,
        })

    df_claims = pd.DataFrame(rows)

    # ── Sheet 2: Errors detail ────────────────────────────────────────────────
    err_rows = []
    for c in claims:
        for e in c.errors:
            err_rows.append({
                "แถวที่": c.row_number,
                "HN": c.hn,
                "รหัสข้อผิดพลาด": e.error_code,
                "หมวดหมู่": e.error_category,
                "ฟิลด์": e.error_field,
                "ระดับ": e.severity.value,
                "ข้อความ (ไทย)": e.error_message_th or "",
                "ค่าที่พบ": e.current_value or "",
                "ค่าที่ควรจะเป็น": e.expected_value or "",
                "แก้ไขแล้ว": "ใช่" if e.is_resolved else "ยัง",
            })

    df_errors = pd.DataFrame(err_rows) if err_rows else pd.DataFrame(
        columns=["แถวที่", "HN", "รหัสข้อผิดพลาด", "หมวดหมู่", "ฟิลด์",
                 "ระดับ", "ข้อความ (ไทย)", "ค่าที่พบ", "ค่าที่ควรจะเป็น", "แก้ไขแล้ว"]
    )

    # ── Sheet 3: Summary ──────────────────────────────────────────────────────
    summary_data = {
        "รายการ": ["Batch", "ไฟล์", "สิทธิ์", "จำนวนทั้งหมด",
                   "ผ่าน", "ไม่ผ่าน", "ติด C", "ยอดรวมค่ารักษา"],
        "ค่า": [
            batch.batch_no,
            batch.filename,
            batch.claim_type.value,
            batch.total_records,
            batch.passed_records,
            batch.failed_records,
            batch.flagged_records,
            f"{batch.total_amount:,.2f}",
        ]
    }
    df_summary = pd.DataFrame(summary_data)

    # Write to Excel buffer
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        df_summary.to_excel(writer, sheet_name="สรุป", index=False)
        df_claims.to_excel(writer, sheet_name="รายการทั้งหมด", index=False)
        df_errors.to_excel(writer, sheet_name="ข้อผิดพลาด", index=False)

        # Auto-width columns
        for sheet_name in writer.sheets:
            ws = writer.sheets[sheet_name]
            for col in ws.columns:
                max_len = max((len(str(cell.value)) for cell in col if cell.value), default=10)
                ws.column_dimensions[col[0].column_letter].width = min(max_len + 4, 50)

    buf.seek(0)
    return buf.read()
