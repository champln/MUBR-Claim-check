"""
ดึงข้อมูล visit ผู้ป่วยนอกจากฐาน HOSxP โดยตรง (live) เพื่อรัน Pre-screen แบบกึ่ง real-time

ใช้ connection เดียวกับที่ตั้งค่าไว้ในหน้า Settings (hosxp_connection_config.db_url)
รองรับทั้ง HOSxP XE (PostgreSQL) และ HOSxP รุ่น MySQL — เขียน SQL แบบกลางที่ทั้งคู่รันได้

โครงตาราง HOSxP ที่ใช้:
  ovst        : vn, hn, vstdate, vsttime, pttype        (visit)
  patient     : hn, cid, pname, fname, lname, birthday, sex
  ovstdiag    : vn, icd10, diagtype ('1' = โรคหลัก)
  opitemrece  : vn, sum_price, an (NULL = OPD)          (ค่าใช้จ่าย)
"""
from __future__ import annotations

import re
from datetime import date
from typing import Any, Optional

from sqlalchemy import bindparam, create_engine, text


class HosxpLiveSourceError(Exception):
    pass


def _engine(db_url: str):
    # pool_pre_ping กัน connection ค้างเมื่อ HOSxP ปิด/รีสตาร์ท (สำคัญกับการ poll ต่อเนื่อง)
    return create_engine(db_url, pool_pre_ping=True)


def test_connection(db_url: str) -> None:
    """ลอง SELECT 1 — raise ถ้าเชื่อมไม่ได้"""
    try:
        with _engine(db_url).connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception as e:
        raise HosxpLiveSourceError(f"เชื่อมต่อฐาน HOSxP ไม่สำเร็จ: {e}")


def fetch_live_opd_records(
    db_url: str,
    date_from: date,
    date_to: date,
    pttypes: Optional[list[str]] = None,
    limit: int = 500,
) -> list[dict[str, Any]]:
    """
    ดึง visit OPD ในช่วงวันที่ + สิทธิ (pttype) ที่กำหนด แล้ว map เป็น record dict
    ให้ตรงกับที่ services.claim_checker.run_prescreen ต้องการ
    """
    limit = max(1, min(int(limit or 500), 2000))
    eng = _engine(db_url)

    # ── 1) visit หลัก ────────────────────────────────────────────────────────
    visit_sql = """
        SELECT o.vn, o.hn, o.vstdate, o.vsttime, o.pttype,
               p.cid, p.pname, p.fname, p.lname, p.birthday, p.sex
        FROM ovst o
        JOIN patient p ON p.hn = o.hn
        WHERE o.vstdate BETWEEN :d1 AND :d2
    """
    params: dict[str, Any] = {"d1": date_from, "d2": date_to}
    if pttypes:
        visit_sql += " AND o.pttype IN :ptt"
        params["ptt"] = pttypes
    visit_sql += " ORDER BY o.vstdate DESC, o.vn DESC LIMIT :lim"
    params["lim"] = limit

    stmt = text(visit_sql)
    if pttypes:
        stmt = stmt.bindparams(bindparam("ptt", expanding=True))

    try:
        with eng.connect() as conn:
            visits = [dict(r) for r in conn.execute(stmt, params).mappings().all()]

            if not visits:
                return []
            vns = [v["vn"] for v in visits]

            # ── 2) การวินิจฉัยทั้งหมดของ VN เหล่านั้น ───────────────────────
            dx_stmt = text(
                "SELECT vn, icd10, diagtype FROM ovstdiag WHERE vn IN :vns ORDER BY vn, diagtype"
            ).bindparams(bindparam("vns", expanding=True))
            dx_rows = conn.execute(dx_stmt, {"vns": vns}).mappings().all()

            # ── 3) ยอดค่าใช้จ่ายรวมต่อ VN (เฉพาะ OPD: an ว่าง) ───────────────
            chg_stmt = text(
                "SELECT vn, SUM(sum_price) AS total FROM opitemrece "
                "WHERE vn IN :vns AND (an IS NULL OR an = '') GROUP BY vn"
            ).bindparams(bindparam("vns", expanding=True))
            chg_rows = conn.execute(chg_stmt, {"vns": vns}).mappings().all()

            # ── 4) กฎเดียวกับเมนูแก้ไฟล์ส่งเบิก (R24 / T42 / CPAP-PSG) จากข้อมูลรายการ ──
            file_rule_issues, file_rule_skipped = _file_rules(conn, vns, visits)
    except HosxpLiveSourceError:
        raise
    except Exception as e:
        raise HosxpLiveSourceError(f"อ่านข้อมูลจาก HOSxP ไม่สำเร็จ: {e}")

    dx_map: dict[str, dict[str, list[str]]] = {}
    for r in dx_rows:
        vn = str(r["vn"])
        slot = dx_map.setdefault(vn, {"pdx": [], "adx": []})
        code = (r["icd10"] or "").strip()
        if not code:
            continue
        if str(r["diagtype"]).strip() == "1":
            slot["pdx"].append(code)
        else:
            slot["adx"].append(code)

    chg_map = {str(r["vn"]): float(r["total"] or 0) for r in chg_rows}

    # ── map เป็น record ตามที่ run_prescreen ใช้ ────────────────────────────
    records: list[dict[str, Any]] = []
    today = date.today()
    for v in visits:
        vn = str(v["vn"])
        dx = dx_map.get(vn, {"pdx": [], "adx": []})
        birthday = v.get("birthday")
        age = None
        if birthday:
            try:
                age = today.year - birthday.year - (
                    (today.month, today.day) < (birthday.month, birthday.day)
                )
            except Exception:
                age = None

        name = f"{(v.get('pname') or '').strip()}{(v.get('fname') or '').strip()} {(v.get('lname') or '').strip()}".strip()
        rec: dict[str, Any] = {
            "claim_no": vn,  # ใช้ VN เป็นเลขอ้างอิง
            "hn": str(v.get("hn") or "").strip() or None,
            "pid": str(v.get("cid") or "").strip() or None,
            "patient_name": name or None,
            "dob": str(birthday) if birthday else None,
            "age": age,
            "visit_date": str(v.get("vstdate") or "") or None,
            "visit_type": "OPD",
            "pdx": dx["pdx"][0] if dx["pdx"] else None,
            "total_charge": chg_map.get(vn, 0.0),
            "pttype": str(v.get("pttype") or "").strip(),
            "sex": str(v.get("sex") or "").strip(),
            "vsttime": str(v.get("vsttime") or ""),
        }
        for i, code in enumerate(dx["adx"][:4], start=1):
            rec[f"adx{i}"] = code
        rec["file_rule_issues"] = file_rule_issues.get(vn, [])
        rec["file_rule_skipped"] = file_rule_skipped
        records.append(rec)

    return records


# ─── กฎจากเมนูแก้ไฟล์ส่งเบิก มาตรวจล่วงหน้าจากฐาน HOSxP ─────────────────────────
# ของที่ทำให้ไฟล์ส่งเบิกติด C แต่เห็นได้ตั้งแต่ข้อมูลใน HOSxP — แก้ที่ต้นทางก่อน export ได้เลย
#   R24 : ยาที่ไม่มีวิธีใช้ (drugusage/sp_use ไม่มีข้อความ) หรือวิธีใช้มีอักขระ & < >
#   T42 : วันที่สั่งรายการ (rxdate) ไม่ตรงวัน visit
#   P05 : visit ที่มีรายการ CPAP / ตรวจการนอนหลับ แต่แพทย์ผู้ตรวจไม่ใช่เลข ว ที่ลงทะเบียนไว้
# แต่ละกฎเป็น query แยก — HOSxP บางแห่งชื่อคอลัมน์ต่างกัน กฎไหนรันไม่ได้ก็ข้าม (แจ้งใน skipped)
# ไม่ให้ Pre-screen สดทั้งหน้าล้ม
_FORBIDDEN_SIG = re.compile(r"[&<>]")
_CPAP_RE = re.compile(r"cpap", re.IGNORECASE)
_PSG_RE = re.compile(r"sleep\s*test|polysomnogram|ตรวจการนอนหลับ", re.IGNORECASE)
_DOCTOR_BY_CLAIM = {"CPAP": ("47988", "ว47988"), "PSG": ("29312", "ว29312")}


def _issue(code: str, category: str, field: str, message_th: str, severity: str = "ERROR",
           current_value: Optional[str] = None) -> dict:
    return {"code": code, "category": category, "field": field, "message_th": message_th,
            "severity": severity, "current_value": current_value}


def _rollback(conn) -> None:
    """PostgreSQL ยกเลิกทั้ง transaction เมื่อ query ล้ม — ต้อง rollback ก่อนรันกฎถัดไป"""
    try:
        conn.rollback()
    except Exception:
        pass


def _file_rules(conn, vns: list, visits: list) -> tuple:
    issues: dict[str, list[dict]] = {}
    skipped: list[str] = []
    add = lambda vn, i: issues.setdefault(str(vn), []).append(i)  # noqa: E731

    # R24 — วิธีใช้ยา (เฉพาะรายการที่เป็นยา: อยู่ในตาราง drugitems)
    try:
        rows = conn.execute(text(
            "SELECT oi.vn, d.name AS drug_name, oi.drugusage, oi.sp_use, "
            "       du.name1 AS du1, du.name2 AS du2, du.name3 AS du3, "
            "       sp.name1 AS sp1, sp.name2 AS sp2, sp.name3 AS sp3 "
            "FROM opitemrece oi "
            "JOIN drugitems d ON d.icode = oi.icode "
            "LEFT JOIN drugusage du ON du.drugusage = oi.drugusage "
            "LEFT JOIN sp_use sp ON sp.sp_use = oi.sp_use "
            "WHERE oi.vn IN :vns AND (oi.an IS NULL OR oi.an = '')"
        ).bindparams(bindparam("vns", expanding=True)), {"vns": vns}).mappings().all()
        for r in rows:
            sig = " ".join(str(r[k] or "").strip() for k in ("du1", "du2", "du3", "sp1", "sp2", "sp3")).strip()
            drug = str(r["drug_name"] or "").strip()
            if not sig:
                add(r["vn"], _issue("R24", "DRUG", "drugusage",
                                    f"ยา {drug} ไม่มีข้อความวิธีใช้ — ไฟล์ส่งเบิกจะติด C R24 (ขาดวิธีการใช้ยา)",
                                    current_value=str(r["drugusage"] or "")))
            elif _FORBIDDEN_SIG.search(sig):
                add(r["vn"], _issue("R24", "DRUG", "drugusage",
                                    f"วิธีใช้ยา {drug} มีอักขระ & < > — สกส. อ่านไม่ได้ ติด R24/ไฟล์ไม่ผ่าน",
                                    current_value=sig[:80]))
    except Exception:
        _rollback(conn)
        skipped.append("R24 วิธีใช้ยา")

    # T42 — วันที่ของรายการต้องตรงวัน visit
    try:
        vdate = {str(v["vn"]): str(v.get("vstdate") or "")[:10] for v in visits}
        rows = conn.execute(text(
            "SELECT vn, rxdate, COUNT(*) AS n FROM opitemrece "
            "WHERE vn IN :vns AND (an IS NULL OR an = '') GROUP BY vn, rxdate"
        ).bindparams(bindparam("vns", expanding=True)), {"vns": vns}).mappings().all()
        for r in rows:
            rx = str(r["rxdate"] or "")[:10]
            want = vdate.get(str(r["vn"]), "")
            if rx and want and rx != want:
                add(r["vn"], _issue("T42", "DATE", "rxdate",
                                    f"มี {r['n']} รายการวันที่ {rx} ไม่ตรงวัน visit {want} — ไฟล์ส่งเบิกจะติด C T42",
                                    severity="WARNING", current_value=rx))
    except Exception:
        _rollback(conn)
        skipped.append("T42 วันที่รายการ")

    # P05 — CPAP / PSG ต้องใช้แพทย์ตามที่ลงทะเบียนไว้กับ สกส.
    try:
        rows = conn.execute(text(
            "SELECT oi.vn, COALESCE(n.name, d.name) AS item_name, doc.licenseno "
            "FROM opitemrece oi "
            "JOIN ovst o ON o.vn = oi.vn "
            "LEFT JOIN nondrugitems n ON n.icode = oi.icode "
            "LEFT JOIN drugitems d ON d.icode = oi.icode "
            "LEFT JOIN doctor doc ON doc.code = o.doctor "
            "WHERE oi.vn IN :vns"
        ).bindparams(bindparam("vns", expanding=True)), {"vns": vns}).mappings().all()
        kind_by_vn: dict[str, tuple] = {}
        for r in rows:
            name = str(r["item_name"] or "")
            kind = "CPAP" if _CPAP_RE.search(name) else "PSG" if _PSG_RE.search(name) else None
            if kind and kind_by_vn.get(str(r["vn"]), ("",))[0] != "CPAP":
                kind_by_vn[str(r["vn"])] = (kind, str(r["licenseno"] or "").strip())
        for vn, (kind, lic) in kind_by_vn.items():
            digits, want = _DOCTOR_BY_CLAIM[kind]
            if re.sub(r"\D", "", lic) != digits:
                add(vn, _issue("P05", "DOC", "doctor",
                               f"visit {kind} แต่แพทย์ผู้ตรวจเลข {lic or '(ว่าง)'} — ต้องเป็น {want} "
                               "(แก้ในเมนู CPAP / PSG ก่อนส่ง หรือแก้ใน HOSxP)",
                               severity="WARNING", current_value=lic))
            if kind == "CPAP":
                add(vn, _issue("P02", "DOC", "auth",
                               "เคส CPAP — เตรียมเลขกำกับการเบิกจากเว็บ สกส. (ตัวพิมพ์ใหญ่) ใส่ตอนแก้ไฟล์",
                               severity="INFO"))
    except Exception:
        _rollback(conn)
        skipped.append("P05 แพทย์ CPAP/PSG")

    return issues, skipped
