"""
ตรวจไฟล์ส่งเบิกหาเงื่อนไข "ติด C" ทุกแบบที่ระบบรู้จัก ในครั้งเดียว

ใช้ตรรกะตัวเดียวกับเมนูแก้เฉพาะเคส เพื่อไม่ให้ผลตรวจกับผลแก้ขัดกันเอง
— ที่นี่เรียกเฉพาะฟังก์ชัน preview_* จึงไม่แตะไฟล์
"""
from typing import Dict, List

from services import cipn_file_editor as cipn
from services.cipn_validator import validate as validate_cipn
from services.aipn_signer import verify as verify_hmac
from services.csop_file_editor import analyze as analyze_cpap
from services.csop_file_editor import (
    preview_claimcont_fix,
    preview_opd_fee_fix,
    preview_sig_fix,
    preview_stdcode_fix,
    preview_svdate_fix,
    preview_total_sync,
    verify_checksum,
)


def _finding(code: str, title: str, detail: str, count: int, menu: str, to: str,
             severity: str = "ERROR", rows: List[dict] = None) -> dict:
    return {
        "code": code,
        "title": title,
        "detail": detail,
        "count": count,
        "menu": menu,
        "to": to,
        "severity": severity,
        "rows": (rows or [])[:20],
    }


def check_c_codes(files: Dict[str, bytes]) -> dict:
    """คืนรายการเงื่อนไขติด C ที่พบในชุดไฟล์ พร้อมเมนูที่ใช้แก้"""
    findings: List[dict] = []
    checked: List[str] = []
    skipped: List[dict] = []

    # ── ลายเซ็นท้ายไฟล์ของทุกแฟ้ม ────────────────────────────────────────────
    bad_sig: List[dict] = []
    for name, raw in sorted(files.items()):
        if cipn.is_cipn(raw):
            ok = verify_hmac(raw)
            label = "ค่า HMAC"
        else:
            ok = verify_checksum(raw)
            label = "Checksum"
        if ok is False:
            bad_sig.append({"file": name, "kind": label})
    if bad_sig:
        findings.append(_finding(
            "22", "ลายเซ็นท้ายไฟล์ไม่ตรงกับเนื้อไฟล์",
            "ไฟล์ถูกแก้โดยไม่ได้คำนวณลายเซ็นใหม่ — ส่งแบบนี้จะถูกตีกลับ",
            len(bad_sig), "แก้ DateRev ผู้ป่วยใน", "/cipn-daterev", rows=bad_sig,
        ))
    checked.append("ลายเซ็นท้ายไฟล์ทุกแฟ้ม")

    # ── S19 / S41: รหัสหัตถการใน OPServices ─────────────────────────────────
    try:
        p = preview_stdcode_fix(files)
        checked.append("รหัสหัตถการ (S19/S41)")
        fill = [r for r in p["rows"] if r["issue"] == "S41"]
        if fill or p["unresolved_count"]:
            findings.append(_finding(
                "S41", "หัตถการไม่มีรหัส STDCode",
                f"ระบบเติมให้ได้ {len(fill)} แถว · ต้องกรอกเอง {p['unresolved_count']} แถว",
                len(fill) + p["unresolved_count"], "แก้รหัสหัตถการ", "/stdcode-fix",
                rows=fill + p["unresolved"],
            ))
    except ValueError as e:
        skipped.append({"check": "รหัสหัตถการ (S19/S41)", "reason": str(e)})

    # ── T33 / T45: ยอดเบิกค่าบริการเป็น 0.00 ────────────────────────────────
    try:
        p = preview_opd_fee_fix(files)
        checked.append("ยอดเบิกค่าบริการ (T33/T45)")
        if p["total_change_count"]:
            findings.append(_finding(
                "T33/T45", "ค่าบริการทั่วไป ผป.นอก มียอดเบิกเป็น 0.00",
                "รายการมียอดอยู่แต่ช่องเบิกได้/ขอเบิกเป็น 0.00",
                p["total_change_count"], "แก้ยอดค่าบริการ", "/opd-fee-fix", rows=p["rows"],
            ))
    except ValueError as e:
        skipped.append({"check": "ยอดเบิกค่าบริการ (T33/T45)", "reason": str(e)})

    # ── A04: ยอดหัวบิลไม่ตรงผลรวมรายการ ─────────────────────────────────────
    try:
        p = preview_total_sync(files)
        checked.append("ยอดหัวบิล (A04)")
        if p["total_change_count"]:
            findings.append(_finding(
                "A04", "ยอดหัวบิลไม่ตรงกับผลรวมรายการ",
                "ยอดรวม/ยอดขอเบิกใน BILLTRAN ไม่เท่าผลรวมของ BillItems",
                p["total_change_count"], "แก้ยอดค่าบริการ", "/opd-fee-fix", rows=p["rows"],
            ))
    except ValueError as e:
        skipped.append({"check": "ยอดหัวบิล (A04)", "reason": str(e)})

    # ── T42: วันที่รายการไม่ตรงวัน visit ────────────────────────────────────
    try:
        p = preview_svdate_fix(files)
        checked.append("วันที่ให้บริการ (T42)")
        if p["total_change_count"]:
            findings.append(_finding(
                "T42", "วันที่ของรายการไม่ตรงกับวัน visit",
                "SVDATE ใน BillItems ไม่สัมพันธ์กับวันรับบริการใน BILLTRAN",
                p["total_change_count"], "แก้วันที่ให้บริการ", "/svdate-fix", rows=p["rows"],
            ))
        if p.get("other_mismatches"):
            findings.append(_finding(
                "T42*", "แฟ้มอื่นมีวันที่ไม่ตรงกับวัน visit",
                "อาจเป็นวัน visit เองที่ผิด — ควรตรวจกับ HOSxP ก่อน ระบบไม่แก้ให้",
                len(p["other_mismatches"]), "แก้วันที่ให้บริการ", "/svdate-fix",
                severity="WARNING", rows=p["other_mismatches"],
            ))
    except ValueError as e:
        skipped.append({"check": "วันที่ให้บริการ (T42)", "reason": str(e)})

    # ── R24: ยาไม่มีวิธีใช้ใน BILLDISP ───────────────────────────────────────
    try:
        p = preview_sig_fix(files)
        checked.append("วิธีการใช้ยา (R24)")
        empty = [r for r in p["rows"] if r["issue"] == "EMPTY"]
        chars = [r for r in p["rows"] if r["issue"] == "CHARS"]
        if empty:
            findings.append(_finding(
                "R24", "ยาไม่มีวิธีการใช้ (sigText ว่าง)",
                "แพทย์อาจระบุวิธีใช้แล้วแต่รหัสวิธีใช้ใน HOSxP ไม่มีข้อความ — ต้องเติมวิธีใช้ก่อนส่ง",
                len(empty), "เติมวิธีใช้ยา", "/sig-fix", rows=empty,
            ))
        if chars:
            findings.append(_finding(
                "R24", "วิธีใช้ยามีอักขระ & < >",
                "สกส. อ่านอักขระเหล่านี้ไม่ได้ ข้อความวิธีใช้จะหาย/ไฟล์ไม่ผ่าน — ต้องแทนเป็นคำก่อนส่ง",
                len(chars), "เติมวิธีใช้ยา", "/sig-fix", rows=chars,
            ))
    except ValueError as e:
        skipped.append({"check": "วิธีการใช้ยา (R24)", "reason": str(e)})

    # ── CPAP / PSG (โครงการหยุดหายใจขณะหลับ): P02 / P05 / STCPAP / ED ────────
    try:
        a = analyze_cpap(files)
        if a["cpap_visits"]:
            checked.append("เบิก CPAP / Polysomnogram (P02/P05)")
        probs = [{"invno": v["visit_no"], "type": v["claim_type"], **p}
                 for v in a["cpap_visits"] for p in v["problems"]]
        titles = {
            "P02": "เลขกำกับการเบิก CPAP ไม่มี หรือไม่ใช่ตัวพิมพ์ใหญ่",
            "P05": "เลข ว แพทย์ไม่ตรงกับที่ลงทะเบียนไว้",
            "STCPAP": "เคส CPAP ไม่มี STCPAP ใน BILLTRAN.AuthCode",
            "ED": "เคส CPAP/PSG ไม่ได้ระบุ Class = ED ใน OPServices",
        }
        for code, title in titles.items():
            rows = [p for p in probs if p["code"] == code]
            if rows:
                findings.append(_finding(
                    code if code.startswith("P") else f"CPAP-{code}", title,
                    "แก้ได้ในเมนูแก้ไฟล์เบิก CPAP / PSG ตามแนวปฏิบัติ สกส. ว 214",
                    len(rows), "CPAP / PSG", "/cpap-fix", rows=rows,
                ))
    except ValueError as e:
        skipped.append({"check": "เบิก CPAP / Polysomnogram", "reason": str(e)})

    # ── G04: เหตุผลการใช้ยาเป็น EF แต่มียอดเบิก ─────────────────────────────
    try:
        p = preview_claimcont_fix(files)
        checked.append("เหตุผลการใช้ยา (G04)")
        g04 = [r for r in p["rows"] if r["issue"] == "G04"]
        inc = [r for r in p["rows"] if r["issue"] == "INCOMPLETE"]
        if g04:
            findings.append(_finding(
                "G04", "เหตุผลการใช้ยาเป็น EF (ไม่เบิก) แต่มียอดเบิก",
                "เปลี่ยนเหตุผลเป็นค่าที่แพทย์สรุป (ส่วนใหญ่ EE)",
                len(g04), "เหตุผลการใช้ยา", "/claimcont-fix", rows=g04,
            ))
        if inc:
            findings.append(_finding(
                "G04*", "เหตุผลการใช้ยาไม่ครบ (มีแค่ E)",
                "HOSxP ส่งเหตุผลไปไม่ครบ 2 ตัวอักษร — ควรระบุ EA–EE ให้ครบ",
                len(inc), "เหตุผลการใช้ยา", "/claimcont-fix", severity="WARNING", rows=inc,
            ))
    except ValueError as e:
        skipped.append({"check": "เหตุผลการใช้ยา (G04)", "reason": str(e)})

    # ── ผู้ป่วยใน: ClaimCat / ยอดรวม / โครงสร้าง (รหัส 30, 35, 36) ──────────
    for name, raw in sorted(files.items()):
        if not cipn.is_cipn(raw):
            continue
        checked.append(f"ClaimCat และยอดรวมในไฟล์ผู้ป่วยใน ({name})")
        v = validate_cipn(raw)
        by_code: Dict[str, List[dict]] = {}
        for f in v["findings"]:
            if f["code"] == "22":
                continue      # ตรวจลายเซ็นไปแล้วด้านบน
            by_code.setdefault(f"{f['code']}|{f['severity']}", []).append(f)
        titles = {
            "30": "รูปแบบไฟล์ไม่ถูกต้อง",
            "35": "DRGCharge / ClaimCat ของรายการที่เบิกรวมใน DRG ไม่ถูกต้อง",
            "36": "XDRGClaim / ClaimCat ของรายการที่เบิกแยกนอก DRG ไม่ถูกต้อง",
        }
        for key, items in by_code.items():
            code, severity = key.split("|")
            findings.append(_finding(
                code, titles.get(code, "ข้อผิดพลาดในไฟล์ผู้ป่วยใน"),
                items[0]["message"][:120],
                len(items), "ตรวจ/แก้ ClaimCat ผู้ป่วยใน", "/cipn-fix",
                severity=severity,
                rows=[{"where": i["where"], "message": i["message"], "suggest": i["suggest"]} for i in items],
            ))

    # ── ผู้ป่วยใน: DateRev เป็นวันที่ส่งออกไฟล์ ─────────────────────────────
    for name, raw in sorted(files.items()):
        if not cipn.is_cipn(raw):
            continue
        checked.append(f"DateRev ในไฟล์ผู้ป่วยใน ({name})")
        try:
            p = cipn.preview_daterev(raw)
        except ValueError:
            continue
        if p["suspect_count"]:
            findings.append(_finding(
                "DateRev", "วันที่ปรับปรุงล่าสุดเป็นวันที่ส่งออกไฟล์",
                f"รายการที่ไม่เคยตั้ง DateRev ใน HOSxP ถูก export เป็น {p['export_date']}",
                p["suspect_count"], "แก้ DateRev ผู้ป่วยใน", "/cipn-daterev",
                severity="WARNING", rows=[r for r in p["rows"] if r["suspect"]],
            ))

    return {
        "files": sorted(files),
        "findings": findings,
        "error_count": sum(f["count"] for f in findings if f["severity"] == "ERROR"),
        "warning_count": sum(f["count"] for f in findings if f["severity"] == "WARNING"),
        "checked": checked,
        "skipped": skipped,
    }
