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
        records.append(rec)

    return records
