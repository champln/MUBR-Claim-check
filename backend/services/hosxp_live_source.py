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
from datetime import date, timedelta
from typing import Any, Optional

from sqlalchemy import bindparam, text

from services.hosxp_engine import get_engine


class HosxpLiveSourceError(Exception):
    pass


def _engine(db_url: str):
    # engine กลาง 1 ตัวต่อ URL (pool เล็ก) — ไม่สร้างใหม่ทุกรอบ poll จน connection ชนเพดาน
    return get_engine(db_url)


def test_connection(db_url: str) -> None:
    """ลอง SELECT 1 — raise ถ้าเชื่อมไม่ได้"""
    try:
        with _engine(db_url).connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception as e:
        raise HosxpLiveSourceError(f"เชื่อมต่อฐาน HOSxP ไม่สำเร็จ: {e}")


HIPDATA_GROUP_TH = {
    "OFC": "กรมบัญชีกลาง", "LGO": "อปท.", "SSS": "ประกันสังคม", "UCS": "บัตรทอง (UC)",
    "BKK": "กทม.", "XXX": "ชำระเอง/อื่นๆ",
}


def list_pttypes(db_url: str) -> list[dict]:
    """
    ทะเบียนสิทธิการรักษา (pttype) — สิทธิที่เปิดใช้ + สิทธิที่มี visit ใน 90 วันล่าสุด
    พร้อมจำนวน visit 90 วัน (ใช้เรียงสิทธิที่ใช้บ่อยขึ้นก่อน)
    """
    try:
        with _engine(db_url).connect() as conn:
            rows = conn.execute(text(
                "SELECT p.pttype, p.name, p.hipdata_code, p.isuse, "
                "       (SELECT COUNT(*) FROM ovst o WHERE o.pttype = p.pttype "
                "        AND o.vstdate >= :since) AS visits "
                "FROM pttype p"
            ), {"since": date.today() - timedelta(days=90)}).mappings().all()
    except Exception as e:
        raise HosxpLiveSourceError(f"อ่านทะเบียนสิทธิจาก HOSxP ไม่สำเร็จ: {e}")
    out = []
    for r in rows:
        visits = int(r["visits"] or 0)
        if str(r["isuse"] or "").strip().upper() != "Y" and visits == 0:
            continue
        hip = str(r["hipdata_code"] or "").strip()
        out.append({"pttype": str(r["pttype"]).strip(), "name": str(r["name"] or "").strip(),
                    "hipdata_code": hip, "group": HIPDATA_GROUP_TH.get(hip, "อื่นๆ"), "visits_90d": visits})
    out.sort(key=lambda x: (-x["visits_90d"], x["pttype"]))
    return out


# ตาราง/คอลัมน์ที่ Pre-screen สดใช้ แยกตามกฎ — ใช้ตรวจความพร้อมก่อนเปิดใช้งานจริง
LIVE_REQUIREMENTS = [
    ("ข้อมูล visit พื้นฐาน (ต้องมี)", True, {
        "ovst": ["vn", "hn", "vstdate", "vsttime", "pttype"],
        "patient": ["hn", "cid", "pname", "fname", "lname", "birthday", "sex"],
        "ovstdiag": ["vn", "icd10", "diagtype"],
        "opitemrece": ["vn", "sum_price", "an"],
    }),
    ("R24 วิธีใช้ยา", False, {
        "opitemrece": ["icode", "drugusage", "sp_use"],
        "drugitems": ["icode", "name"],
        "drugusage": ["drugusage", "name1", "name2", "name3"],
        "sp_use": ["sp_use", "name1", "name2", "name3"],
    }),
    ("T42 วันที่รายการ", False, {"opitemrece": ["rxdate"]}),
    ("P05 แพทย์ CPAP/PSG", False, {
        "ovst": ["doctor"],
        "doctor": ["code", "licenseno"],
        "nondrugitems": ["icode", "name"],
    }),
    ("G04 เหตุผลการใช้ยานอกบัญชี", False, {
        "ovst_presc_ned": ["vn", "icode", "presc_reason", "reason_ef"],
        "drugitems_ned_reason_list": ["doctor_reason", "claim_control"],
        "opitemrece": ["paidst"],
    }),
    ("S41 รหัสหัตถการ", False, {
        "doctor_operation": ["vn", "er_oper_code", "icd9"],
        "er_oper_code": ["er_oper_code", "name", "icd9cm"],
    }),
    ("T33 ค่าบริการผู้ป่วยนอก", False, {"pttype": ["pttype", "paidst"], "opitemrece": ["paidst"]}),
    ("FEE ค่าธรรมเนียมโรงพยาบาล 50 บาท", False, {
        "ovst": ["vn", "hn", "vstdate", "doctor", "spclty"],
        "opitemrece": ["vn", "icode", "qty", "paidst"],
        "nondrugitems": ["icode", "name"],
        "spclty": ["spclty", "name"],
        "doctor": ["code", "name"],
    }),
    ("ผู้ป่วยใน (เมนูผู้ป่วยใน)", False, {
        "ipt": ["an", "hn", "regdate", "dchdate", "pttype", "ward", "spclty", "admdoctor", "dch_doctor",
                "drg", "rw", "adjrw"],
        "an_stat": ["an", "admdate", "item_money"],
        "iptdiag": ["an", "icd10", "diagtype"],
        "ipt_pttype": ["an", "auth_code"],
        "ward": ["ward", "name"],
        "nondrugitems": ["icode", "name", "income"],
    }),
    ("แบบประสานศูนย์สิทธิ์: เหมารวม / ผู้สั่ง / ประเภทชำระ / อุปกรณ์หมวด 2 / เวลาซ้ำ (BND01 ORD01 PAY01 Q04 C05)", False, {
        "pttype": ["pttype", "hipdata_code"],
        "opitemrece": ["vn", "icode", "paidst", "income", "doctor", "an"],
        "nondrugitems": ["icode", "name", "paidst"],
        "drugitems": ["icode", "name", "paidst"],
        "doctor": ["code", "name", "provider_type_code"],
    }),
    ("แบบประสานศูนย์สิทธิ์: lab COVID / TMLT (V02 L01)", False, {
        "lab_items": ["icode", "lab_items_name", "tmlt_code"],
        "nondrugitems": ["sks_tmlt_code"],
    }),
    ("แบบประสานศูนย์สิทธิ์: TMT ยา / เลข ว. แพทย์ (G06 S48)", False, {
        "drugitems": ["tmt_tp_code"],
        "doctor": ["licenseno"],
    }),
    ("แสดงแผนก / ห้องตรวจ", False, {
        "ovst": ["spclty", "main_dep", "cur_dep"],
        "spclty": ["spclty", "name"],
        "kskdepartment": ["depcode", "department"],
    }),
]


def check_readiness(db_url: str) -> dict:
    """
    ตรวจว่าฐาน HOSxP มีตาราง/คอลัมน์ครบสำหรับแต่ละกฎหรือไม่ (อ่านเฉพาะโครงสร้าง ไม่อ่านข้อมูลผู้ป่วย)
    """
    from sqlalchemy import inspect as sa_inspect

    try:
        eng = _engine(db_url)
        insp = sa_inspect(eng)
        dialect = eng.dialect.name
        tables = {t.lower() for t in insp.get_table_names()}
    except Exception as e:
        raise HosxpLiveSourceError(f"เชื่อมต่อฐาน HOSxP ไม่สำเร็จ: {e}")

    cols_cache: dict[str, set] = {}

    def cols(t: str) -> set:
        if t not in cols_cache:
            try:
                cols_cache[t] = {c["name"].lower() for c in insp.get_columns(t)}
            except Exception:
                cols_cache[t] = set()
        return cols_cache[t]

    # สิทธิ์ SELECT ต่อตาราง — เห็นโครงสร้างได้ไม่ได้แปลว่าอ่านข้อมูลได้
    # (WHERE 1=0 ไม่คืนแถวใดๆ จึงไม่อ่านข้อมูลผู้ป่วย)
    perm_cache: dict[str, bool] = {}

    def can_select(t: str) -> bool:
        if t not in perm_cache:
            try:
                with eng.connect() as conn:
                    conn.execute(text(f"SELECT 1 FROM {t} WHERE 1=0"))
                perm_cache[t] = True
            except Exception:
                perm_cache[t] = False
        return perm_cache[t]

    checks = []
    no_select: set = set()
    for name, required, need in LIVE_REQUIREMENTS:
        missing = []
        for t, cs in need.items():
            if t not in tables:
                missing.append(f"ตาราง {t}")
                continue
            have = cols(t)
            missing += [f"{t}.{c}" for c in cs if c not in have]
            if not can_select(t):
                missing.append(f"ไม่มีสิทธิ์อ่าน (SELECT) ตาราง {t}")
                no_select.add(t)
        checks.append({"rule": name, "required": required, "ok": not missing, "missing": missing})
    # ชื่อสิทธิ (ไม่บังคับ) — ไม่มีสิทธิ์ก็ใช้แค่รหัสสิทธิ
    if "pttype" in tables and not can_select("pttype"):
        no_select.add("pttype")
    return {"dialect": dialect, "checks": checks,
            "ready": all(c["ok"] for c in checks if c["required"]),
            "no_select": sorted(no_select),
            "db_user": eng.url.username or ""}


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
            fee_issues, fee_skipped = _fee_rules(conn, vns, visits)
            for vn_, lst in fee_issues.items():
                file_rule_issues.setdefault(vn_, []).extend(lst)
            file_rule_skipped += fee_skipped
            coord_issues, coord_skipped = _coord_rules(conn, vns, visits)
            for vn_, lst in coord_issues.items():
                file_rule_issues.setdefault(vn_, []).extend(lst)
            file_rule_skipped += coord_skipped

            # ── 6) แผนก (spclty) / ห้องตรวจ (main_dep) / ห้องที่อยู่ตอนนี้ (cur_dep) ─────────
            dept_map = _visit_departments(conn, vns)

            # ── 5) ชื่อสิทธิ (pttype.name) — ไม่มีตารางนี้ก็ใช้รหัสสิทธิอย่างเดียว ─────────
            pttype_names: dict[str, str] = {}
            try:
                codes = sorted({str(v.get("pttype") or "").strip() for v in visits} - {""})
                if codes:
                    pt_rows = conn.execute(text(
                        "SELECT pttype, name FROM pttype WHERE pttype IN :codes"
                    ).bindparams(bindparam("codes", expanding=True)), {"codes": codes}).mappings().all()
                    pttype_names = {str(r["pttype"]).strip(): str(r["name"] or "").strip() for r in pt_rows}
            except Exception:
                _rollback(conn)
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
        # HOSxP เก็บรหัสหัตถการ ICD-9-CM (ตัวเลขล้วน เช่น 3995, 9335) ไว้ใน ovstdiag ด้วย
        # รหัสโรค ICD-10 ขึ้นต้นด้วยตัวอักษรเสมอ — ตัวเลขล้วนจึงไม่นับเป็นวินิจฉัยรอง
        if not code[0].isalpha():
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
            # run_prescreen ต้องมี claim_type (ไม่มีจะติด DOC005 ทุก visit) — ใช้รหัส+ชื่อสิทธิจาก HOSxP
            **dept_map.get(vn, {}),
            "pttype_name": pttype_names.get(str(v.get("pttype") or "").strip(), ""),
            "claim_type": " ".join(x for x in (str(v.get("pttype") or "").strip(),
                                               pttype_names.get(str(v.get("pttype") or "").strip(), "")) if x) or None,
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


# ─── ค่าธรรมเนียมโรงพยาบาล 50 บาท (ประกาศมหาวิทยาลัยมหิดล มีผล 1 ต.ค. 2566) ────────
# หลักคือ "ตรวจ 1 หมอ คิด 50 บาท" ต่อผู้ป่วยต่อวัน และเป็นรายการชำระเองเบิกไม่ได้
#   FEE001 คิดซ้ำ  : วันเดียวกัน แพทย์คนเดียวกัน คิดค่าธรรมเนียมเกิน 1 ครั้ง
#   FEE002 เบิกได้ : คิดค่าธรรมเนียมเป็น 02 ลูกหนี้สิทธิ (ต้องเป็น 03 ชำระเองเบิกไม่ได้)
#   FEE003 แผนกไม่คิด : คิดค่าธรรมเนียมในเวลาใน visit ของแผนกที่ไม่คิด
#   FEE004 ขาด     : พบแพทย์คนละคนในวันเดียวกันแต่ visit นั้นไม่ได้คิด — เตือนเฉพาะวันที่ผู้ป่วยรายนี้
#                    ถูกคิดค่าธรรมเนียมใน visit อื่นแล้ว (สิทธิที่ไม่เก็บค่าธรรมเนียมจะได้ไม่ถูกเตือน)
# ไม่นับ "ค่าบริการทั่วไปผู้ป่วยนอก" (55020) — สิทธิข้าราชการมีคู่กับค่าธรรมเนียมได้ตามปกติ
FEE_ITEM_PREFIX = "ค่าธรรมเนียมโรงพยาบาล"
FEE_EXEMPT_DEPTS = {"กายภาพบำบัด", "ตรวจสุขภาพ", "แผนไทย", "แพทย์แผนจีน"}
FEE_OK_PAIDST = "03"
# 02 ลูกหนี้สิทธิ = เบิกจากกองทุน -> ผิดประกาศ
# (01 ชำระเองเบิกได้ ใช้กับสิทธิที่นายจ้างจ่ายแทน เช่น ประกันสังคมพนักงานรามา SH/50 — ไม่นับ)
FEE_BAD_PAIDST = "02"
# แผนกที่ไม่คิด ไม่คิดค่าธรรมเนียม "ในเวลา" — คลินิกนอกเวลา (เช่น แผนไทย/แพทย์แผนจีน) คิดค่าธรรมเนียมนอกเวลาได้
FEE_INHOURS_WORD = "ในเวลา"


def _fee_rules(conn, vns: list, visits: list) -> tuple:
    issues: dict[str, list[dict]] = {}
    add = lambda vn, i: issues.setdefault(str(vn), []).append(i)  # noqa: E731
    try:
        info = conn.execute(text(
            "SELECT o.vn, o.doctor, sp.name AS dept, d.name AS doctor_name "
            "FROM ovst o "
            "LEFT JOIN spclty sp ON sp.spclty = o.spclty "
            "LEFT JOIN doctor d ON d.code = o.doctor "
            "WHERE o.vn IN :vns"
        ).bindparams(bindparam("vns", expanding=True)), {"vns": vns}).mappings().all()
        fees = conn.execute(text(
            "SELECT oi.vn, oi.qty, oi.paidst, n.name "
            "FROM opitemrece oi JOIN nondrugitems n ON n.icode = oi.icode "
            "WHERE oi.vn IN :vns AND n.name LIKE :prefix"
        ).bindparams(bindparam("vns", expanding=True)),
            {"vns": vns, "prefix": FEE_ITEM_PREFIX + "%"}).mappings().all()
    except Exception:
        _rollback(conn)
        return issues, ["FEE ค่าธรรมเนียมโรงพยาบาล 50 บาท"]

    meta = {str(r["vn"]): r for r in info}
    fee_n: dict[str, float] = {}
    fee_inhours: dict[str, float] = {}
    for f in fees:
        vn = str(f["vn"])
        fee_n[vn] = fee_n.get(vn, 0) + float(f["qty"] or 1)
        if FEE_INHOURS_WORD in str(f["name"] or "") and "นอกเวลา" not in str(f["name"] or ""):
            fee_inhours[vn] = fee_inhours.get(vn, 0) + float(f["qty"] or 1)
        paid = str(f["paidst"] or "").strip()
        if paid == FEE_BAD_PAIDST:
            add(vn, _issue("FEE002", "AMOUNT", "paidst",
                           "ค่าธรรมเนียมโรงพยาบาล 50 บาทเป็นรายการเบิกไม่ได้ (ตามประกาศ) แต่บันทึกเป็น "
                           "02 ลูกหนี้สิทธิ — ควรเป็น 03 ชำระเองเบิกไม่ได้", current_value=paid))

    # จัดกลุ่ม ผู้ป่วยคนเดียวกัน วันเดียวกัน
    days: dict[tuple, list] = {}
    for v in visits:
        days.setdefault((str(v.get("hn") or ""), str(v.get("vstdate") or "")[:10]), []).append(v)

    for (_hn, _day), vs in days.items():
        vs.sort(key=lambda v: (str(v.get("vsttime") or ""), str(v["vn"])))
        day_has_fee = any(fee_n.get(str(v["vn"]), 0) > 0 for v in vs)
        by_doctor: dict[str, list] = {}
        for v in vs:
            vn = str(v["vn"])
            m = meta.get(vn, {})
            dept = str(m.get("dept") or "").strip()
            if dept in FEE_EXEMPT_DEPTS:
                if fee_inhours.get(vn, 0) > 0:
                    add(vn, _issue("FEE003", "AMOUNT", "fee",
                                   f"แผนก{dept}ไม่คิดค่าธรรมเนียมโรงพยาบาล (ในเวลาราชการ) 50 บาท แต่ visit นี้คิดไว้"))
                continue
            doc = str(m.get("doctor") or "").strip()
            if doc:   # visit ที่ยังไม่ลงแพทย์ ตัดสินไม่ได้ว่าซ้ำ/ขาด จึงไม่นับ
                by_doctor.setdefault(doc, []).append(v)

        for doc, dvs in by_doctor.items():
            doc_name = str(meta.get(str(dvs[0]["vn"]), {}).get("doctor_name") or doc).strip()
            charged = [v for v in dvs if fee_n.get(str(v["vn"]), 0) > 0]
            total = sum(fee_n.get(str(v["vn"]), 0) for v in dvs)
            if total > 1:
                first = str(charged[0]["vn"])
                for v in dvs:
                    vn = str(v["vn"])
                    if fee_n.get(vn, 0) > (1 if vn == first else 0):
                        add(vn, _issue("FEE001", "AMOUNT", "fee",
                                       f"คิดค่าธรรมเนียมโรงพยาบาลซ้ำ — วันนี้พบ {doc_name} คนเดียวกันหลาย visit "
                                       f"(คิดไว้แล้วใน VN {first}) ตรวจ 1 หมอ คิด 50 บาทครั้งเดียว",
                                       severity="WARNING"))
            elif total == 0 and day_has_fee:
                for v in dvs:
                    add(str(v["vn"]), _issue("FEE004", "AMOUNT", "fee",
                                             f"พบ {doc_name} (คนละคนกับ visit อื่นวันนี้) แต่ยังไม่ได้คิด"
                                             "ค่าธรรมเนียมโรงพยาบาล 50 บาท — ตรวจ 1 หมอ คิด 50 บาท",
                                             severity="WARNING"))
    return issues, []


def _visit_departments(conn, vns: list) -> dict:
    """
    แผนก / ห้องตรวจของแต่ละ visit — ไม่บังคับ (ดึงไม่ได้ก็ไม่แสดง ไม่ทำให้ Pre-screen ล้ม)
      spclty   : แผนก (spclty.name)            เช่น อายุรกรรม
      main_dep : ห้องตรวจหลัก (kskdepartment)   เช่น ห้องตรวจ 3
      cur_dep  : ห้องที่ผู้ป่วยอยู่ตอนนี้ — visit ที่ยังไม่มี PDX มักเพราะยังไม่ถึงห้องตรวจ
    """
    out: dict[str, dict] = {}
    try:
        rows = conn.execute(text(
            "SELECT vn, spclty, main_dep, cur_dep, doctor FROM ovst WHERE vn IN :vns"
        ).bindparams(bindparam("vns", expanding=True)), {"vns": vns}).mappings().all()
    except Exception:
        _rollback(conn)
        return out

    sp_codes = sorted({str(r["spclty"] or "").strip() for r in rows} - {""})
    dep_codes = sorted({str(r[k] or "").strip() for r in rows for k in ("main_dep", "cur_dep")} - {""})
    doc_codes = sorted({str(r["doctor"] or "").strip() for r in rows} - {""})
    sp_names: dict[str, str] = {}
    dep_names: dict[str, str] = {}
    doc_names: dict[str, str] = {}
    try:
        if doc_codes:
            doc_names = {str(r["code"]).strip(): str(r["name"] or "").strip() for r in conn.execute(text(
                "SELECT code, name FROM doctor WHERE code IN :c"
            ).bindparams(bindparam("c", expanding=True)), {"c": doc_codes}).mappings().all()}
    except Exception:
        _rollback(conn)
    try:
        if sp_codes:
            sp_names = {str(r["spclty"]).strip(): str(r["name"] or "").strip() for r in conn.execute(text(
                "SELECT spclty, name FROM spclty WHERE spclty IN :c"
            ).bindparams(bindparam("c", expanding=True)), {"c": sp_codes}).mappings().all()}
    except Exception:
        _rollback(conn)
    try:
        if dep_codes:
            dep_names = {str(r["depcode"]).strip(): str(r["department"] or "").strip() for r in conn.execute(text(
                "SELECT depcode, department FROM kskdepartment WHERE depcode IN :c"
            ).bindparams(bindparam("c", expanding=True)), {"c": dep_codes}).mappings().all()}
    except Exception:
        _rollback(conn)

    for r in rows:
        sp = str(r["spclty"] or "").strip()
        main = str(r["main_dep"] or "").strip()
        cur = str(r["cur_dep"] or "").strip()
        out[str(r["vn"])] = {
            "spclty": sp, "spclty_name": sp_names.get(sp, ""),
            "main_dep": main, "main_dep_name": dep_names.get(main, ""),
            "cur_dep": cur, "cur_dep_name": dep_names.get(cur, ""),
            # แพทย์ผู้ตรวจของ visit (ว่าง = ยังไม่ลงแพทย์)
            "doctor_name": doc_names.get(str(r["doctor"] or "").strip(), ""),
        }
    return out


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

    # G04 — ยานอกบัญชีที่แพทย์เลือกเหตุผล EF (ผู้ป่วยแสดงความจำนง = เบิกไม่ได้) แต่คิดเป็นลูกหนี้สิทธิ
    try:
        rows = conn.execute(text(
            "SELECT DISTINCT oi.vn, d.name AS drug_name "
            "FROM ovst_presc_ned n "
            "JOIN opitemrece oi ON oi.vn = n.vn AND oi.icode = n.icode "
            "LEFT JOIN drugitems d ON d.icode = n.icode "
            "LEFT JOIN drugitems_ned_reason_list l ON l.doctor_reason = n.presc_reason "
            "WHERE n.vn IN :vns AND oi.paidst = '02' "
            "AND (l.claim_control = 'EF' OR n.reason_ef IN ('Y', '1', 'T'))"
        ).bindparams(bindparam("vns", expanding=True)), {"vns": vns}).mappings().all()
        for r in rows:
            add(r["vn"], _issue("G04", "DRUG", "ned_reason",
                                f"ยา {str(r['drug_name'] or '').strip()} เหตุผลการใช้ยานอกบัญชีเป็น EF (ผู้ป่วยแสดงความจำนง "
                                "= เบิกไม่ได้) แต่คิดเป็นลูกหนี้สิทธิ — ไฟล์ส่งเบิกจะติด C G04 "
                                "(เปลี่ยนเหตุผลตามที่แพทย์สรุป หรือเปลี่ยนเป็นชำระเอง)"))
    except Exception:
        _rollback(conn)
        skipped.append("G04 เหตุผลการใช้ยา")

    # S41 — หัตถการที่ไม่มีรหัส ICD-9-CM -> OPServices ไม่มี STDCode
    try:
        rows = conn.execute(text(
            "SELECT op.vn, COALESCE(e.name, CAST(op.er_oper_code AS VARCHAR)) AS oper_name "
            "FROM doctor_operation op LEFT JOIN er_oper_code e ON e.er_oper_code = op.er_oper_code "
            "WHERE op.vn IN :vns AND COALESCE(TRIM(op.icd9), '') = '' AND COALESCE(TRIM(e.icd9cm), '') = ''"
        ).bindparams(bindparam("vns", expanding=True)), {"vns": vns}).mappings().all()
        for r in rows:
            add(r["vn"], _issue("S41", "ICD", "icd9",
                                f"หัตถการ {str(r['oper_name'] or '').strip()} ไม่มีรหัส ICD-9-CM — OPServices จะไม่มี STDCode "
                                "(ติด C S41) ใส่รหัสในทะเบียนหัตถการ หรือแก้ในเมนูรหัสหัตถการ",
                                severity="WARNING"))
    except Exception:
        _rollback(conn)
        skipped.append("S41 รหัสหัตถการ")

    # T33/T45 (ไฟล์ CSOP กรมบัญชีกลาง) — ค่าบริการทั่วไปผู้ป่วยนอกของสิทธิกรมบัญชีกลางที่ปกติคิดเป็นลูกหนี้สิทธิ
    # แต่ visit นี้ไม่ได้คิดเป็นลูกหนี้สิทธิ
    # (ยอดเบิกในไฟล์จะเป็น 0.00) — สิทธิเบิกต้นสังกัดที่ผู้ป่วยจ่ายเองก่อน (01) ไม่นับ
    try:
        rows = conn.execute(text(
            "SELECT DISTINCT oi.vn, n.name, oi.paidst "
            "FROM opitemrece oi JOIN ovst o ON o.vn = oi.vn "
            "JOIN pttype p ON p.pttype = o.pttype "
            "JOIN nondrugitems n ON n.icode = oi.icode "
            "WHERE oi.vn IN :vns AND n.name LIKE :svc AND n.name NOT LIKE :nc "
            "AND p.hipdata_code = 'OFC' AND p.paidst = '02' AND COALESCE(oi.paidst, '') <> '02'"
        ).bindparams(bindparam("vns", expanding=True)),
            {"vns": vns, "svc": "ค่าบริการทั่วไปผู้ป่วยนอก%", "nc": "%เบิกไม่ได้%"}).mappings().all()
        for r in rows:
            add(r["vn"], _issue("T33", "AMOUNT", "paidst",
                                f"{str(r['name'] or '').strip()} ไม่ได้คิดเป็นลูกหนี้สิทธิ (บันทึกเป็น {r['paidst'] or '-'}) "
                                "— ยอดเบิกในไฟล์จะเป็น 0.00 ติด C T33/T45",
                                current_value=str(r["paidst"] or "")))
    except Exception:
        _rollback(conn)
        skipped.append("T33 ค่าบริการผู้ป่วยนอก")

    return issues, skipped


# ─── กฎจากแบบประสานศูนย์สิทธิประโยชน์ ปีงบ 2569 (docs/PROPOSED_RULES_FY2569.md) ─────────
# เรื่องที่ศูนย์สิทธิ์ส่งกลับมาให้แก้บ่อย — ตรวจเฉพาะสิทธิกรมบัญชีกลาง/อปท. (hipdata OFC/LGO)
#   BND01 : เบิกเวชภัณฑ์ที่เหมารวมอยู่ในค่าหัตถการแล้ว (ชื่อหัตถการระบุ "รวม ...")
#   ORD01 : ผู้สั่งหัตถการไม่ใช่แพทย์ — ถ้า visit เก็บค่าบริการ/ค่าธรรมเนียม เสี่ยง T84 (ว.435)
#   V02   : lab COVID ที่เบิกได้ — ต้องใส่ AuthCode COV-19 ในไฟล์ส่งเบิก
#   PAY01 : ทะเบียนตั้งเบิกไม่ได้ (03) / รายการตรวจสุขภาพ แต่คิดเป็นลูกหนี้สิทธิ (02)
#   Q04   : อวัยวะเทียม/อุปกรณ์หมวด 2 ในผู้ป่วยนอก
#   C05   : 2 visit คนเดียวกัน วัน-เวลา (นาที) เดียวกัน
#   G06   : ยาที่เบิกได้แต่ไม่มีรหัส TMT
#   L01   : lab ที่เบิกได้แต่ไม่มีรหัส TMLT
#   S48   : แพทย์ผู้ตรวจไม่มีเลขใบประกอบ (ว.)
COORD_HIPDATA = ("OFC", "LGO")
PHYSICIAN_TYPES = {"01", "02"}   # provider_type: แพทย์, ทันตแพทย์
PROVIDER_TYPE_NAMES = {
    "03": "พยาบาลวิชาชีพ", "04": "จพ.สาธารณสุขชุมชน", "05": "นักวิชาการสาธารณสุข",
    "06": "จพ.ทันตสาธารณสุข", "08": "แพทย์แผนไทย/ทางเลือก", "09": "อื่นๆ",
}
OPD_SERVICE_PREFIX = "ค่าบริการทั่วไปผู้ป่วยนอก"

# คำในวงเล็บ "รวม ..." ของชื่อหัตถการ -> คำที่ใช้จับชื่อเวชภัณฑ์ที่เบิกแยกไม่ได้
BUNDLE_KEYWORDS = {
    "iv catheter": ["medicut", "iv catheter", "intracath", "jelco"],
    "iv set": ["iv set", "infusion set"],
    "set infusion pump": ["set infusion pump"],
    "extension": ["extension"],
    "t-way": ["t-way", "3-way", "three way"],
    "top dressing": ["top gauze", "tensofix", "easifix", "bactigras", "top dressing"],
    "เซ็ท": ["set ทำแผล", "ชุดทำแผล"],
    "น้ำยา": ["nss", "betadine", "povidone"],
    "สายสวน": ["nelaton", "foley"],
    "เข็ม": ["needle"],
    "syring": ["syringe"],
    "ชุดเย็บ": ["ชุดเย็บ"],
    "ไหมเย็บ": ["nylon", "silk", "vicryl"],
    "red dot": ["red dot", "electrode"],
    "ออกซิเจน": ["oxygen", "ออกซิเจน"],
}
_COVID_LAB_RE = re.compile(r"covid|sars|cov-2", re.IGNORECASE)
_CHECKUP_RE = re.compile(r"[\[(]\s*ตรวจสุขภาพ")
_OR_IMPLANT_RE = re.compile(r"\(or\)|screw|สกรู|k-wire|plate|wire", re.IGNORECASE)
_LICENSE_RE = re.compile(r"\d{3,}")


def _bundled_keywords(proc_name: str) -> set:
    """
    คำค้นเวชภัณฑ์ที่หัตถการนี้รวมไว้แล้ว — ดูข้อความหลังคำว่า 'รวม' (ข้าม 'ไม่รวม ...')
    อ่านถึงวงเล็บปิดหรือ 'ไม่รวม' ถัดไป
    """
    low = proc_name.lower()
    out: set = set()
    i = low.find("รวม")
    while i >= 0:
        if not low[max(0, i - 3):i].endswith("ไม่"):
            seg = low[i:]
            for stop in ("ไม่รวม", ")", "]"):
                j = seg.find(stop, 3)
                if j > 0:
                    seg = seg[:j]
            for key, words in BUNDLE_KEYWORDS.items():
                if key in seg:
                    out.update(words)
        i = low.find("รวม", i + 3)
    return out


def _coord_rules(conn, vns: list, visits: list) -> tuple:
    issues: dict[str, list[dict]] = {}
    skipped: list[str] = []
    seen: set = set()
    target: list = []

    def add(vn, i, dedup_key=None):
        k = (str(vn), i["code"], dedup_key or i["message_th"])
        if k in seen:
            return
        seen.add(k)
        issues.setdefault(str(vn), []).append(i)

    def q(sql: str, extra: Optional[dict] = None):
        stmt = text(sql).bindparams(bindparam("vns", expanding=True))
        return conn.execute(stmt, {"vns": target, **(extra or {})}).mappings().all()

    # เฉพาะ visit สิทธิกรมบัญชีกลาง / อปท. (ผู้ป่วยนอก)
    try:
        target = [r["vn"] for r in conn.execute(text(
            "SELECT o.vn FROM ovst o JOIN pttype p ON p.pttype = o.pttype "
            "WHERE o.vn IN :vns AND p.hipdata_code IN :hip AND (o.an IS NULL OR o.an = '')"
        ).bindparams(bindparam("vns", expanding=True), bindparam("hip", expanding=True)),
            {"vns": vns, "hip": list(COORD_HIPDATA)}).mappings().all()]
    except Exception:
        _rollback(conn)
        return issues, ["กฎแบบประสานศูนย์สิทธิ์ (อ่านสิทธิ hipdata_code ไม่ได้)"]
    if not target:
        return issues, skipped
    opd = "(oi.an IS NULL OR oi.an = '')"
    fee_like = {"fee": FEE_ITEM_PREFIX + "%", "svc": OPD_SERVICE_PREFIX + "%"}

    # BND01 — เวชภัณฑ์ที่เหมารวมในค่าหัตถการ
    try:
        rows = q(
            "SELECT a.vn, na.name AS proc_name, nb.name AS item_name, b.qty "
            "FROM opitemrece a JOIN nondrugitems na ON na.icode = a.icode "
            "JOIN opitemrece b ON b.vn = a.vn AND b.icode <> a.icode "
            "JOIN nondrugitems nb ON nb.icode = b.icode "
            "WHERE a.vn IN :vns AND (a.an IS NULL OR a.an = '') "
            "AND a.paidst = '02' AND a.income IN ('11','12') AND na.name LIKE :kw "
            "AND b.paidst = '02' AND b.income IN ('05','10')", {"kw": "%รวม%"})
        for r in rows:
            proc = str(r["proc_name"] or "").strip()
            item = str(r["item_name"] or "").strip()
            kws = _bundled_keywords(proc)
            if kws and any(k in item.lower() for k in kws):
                add(r["vn"], _issue(
                    "BND01", "AMOUNT", "opitemrece",
                    f"{item} เหมารวมอยู่ในค่า{proc} แล้ว — ไม่เบิกแยก (มติ คกก.บริหาร ศกพ. 9 เม.ย. 69)",
                    severity="WARNING", current_value=f"จำนวน {r['qty']}"), dedup_key=item)
    except Exception:
        _rollback(conn); skipped.append("BND01 เวชภัณฑ์เหมารวมในหัตถการ")

    # ORD01 — ผู้สั่งหัตถการ/ค่าบริการทางการแพทย์ไม่ใช่แพทย์
    try:
        fee_vns = {str(r["vn"]) for r in q(
            "SELECT DISTINCT oi.vn FROM opitemrece oi JOIN nondrugitems n ON n.icode = oi.icode "
            f"WHERE oi.vn IN :vns AND {opd} AND (n.name LIKE :fee OR n.name LIKE :svc)", fee_like)}
        rows = q(
            "SELECT oi.vn, n.name AS item_name, oi.doctor AS orderer, d.name AS orderer_name, "
            "       d.provider_type_code AS ptype, e.name AS examiner_name "
            "FROM opitemrece oi JOIN ovst o ON o.vn = oi.vn "
            "JOIN nondrugitems n ON n.icode = oi.icode "
            "LEFT JOIN doctor d ON d.code = oi.doctor "
            "LEFT JOIN doctor e ON e.code = o.doctor "
            f"WHERE oi.vn IN :vns AND {opd} AND oi.paidst = '02' AND oi.income IN ('11','12') "
            "AND n.name NOT LIKE :fee AND n.name NOT LIKE :svc", fee_like)
        for r in rows:
            ptype = str(r["ptype"] or "").strip()
            if ptype in PHYSICIAN_TYPES:
                continue
            if not str(r["orderer"] or "").strip():
                who = "ไม่ระบุผู้สั่ง"
            elif not r["orderer_name"]:
                who = "ผู้สั่งไม่อยู่ในทะเบียนแพทย์"
            else:
                who = f"{str(r['orderer_name']).strip()} ({PROVIDER_TYPE_NAMES.get(ptype, 'ไม่ใช่แพทย์')})"
            item = str(r["item_name"] or "").strip()
            fix = f" — แก้ผู้สั่งเป็นแพทย์ผู้ตรวจ ({str(r['examiner_name']).strip()})" if r["examiner_name"] else ""
            if str(r["vn"]) in fee_vns:
                add(r["vn"], _issue("ORD01", "DOCTOR", "opitemrece.doctor",
                                    f"{item} ผู้สั่งไม่ใช่แพทย์ และ visit นี้เก็บค่าบริการ/ค่าธรรมเนียม "
                                    f"— เสี่ยงติด C T84 (ว.435){fix}", current_value=who), dedup_key=item)
            else:
                add(r["vn"], _issue("ORD01", "DOCTOR", "opitemrece.doctor",
                                    f"{item} ผู้สั่งไม่ใช่แพทย์{fix}", severity="WARNING",
                                    current_value=who), dedup_key=item)
    except Exception:
        _rollback(conn); skipped.append("ORD01 ผู้สั่งหัตถการ")

    # V02 — lab COVID ที่เบิกได้
    try:
        rows = q(
            "SELECT oi.vn, li.lab_items_name AS name, "
            "       EXISTS (SELECT 1 FROM ovstdiag x WHERE x.vn = oi.vn AND x.icd10 LIKE 'U07%') AS has_u07 "
            "FROM opitemrece oi JOIN lab_items li ON li.icode = oi.icode "
            f"WHERE oi.vn IN :vns AND {opd} AND oi.paidst = '02'")
        for r in rows:
            name = str(r["name"] or "").strip()
            if not _COVID_LAB_RE.search(name) or "เบิกไม่ได้" in name:
                continue
            msg = f"เบิก {name} — ไฟล์ส่งเบิกต้องใส่ AuthCode COV-19 (เมนูแก้ COVID-19) ไม่งั้นติด C V02"
            if not r["has_u07"]:
                msg += " · ไม่มีรหัสโรค U07 ตรวจว่าอาการเข้าเกณฑ์เบิกตามระเบียบ บก."
            add(r["vn"], _issue("V02", "AMOUNT", "AuthCode", msg, severity="WARNING"), dedup_key=name)
    except Exception:
        _rollback(conn); skipped.append("V02 lab COVID")

    # PAY01 — รายการเบิกไม่ได้ แต่คิดเป็นลูกหนี้สิทธิ
    try:
        rows = q(
            "SELECT oi.vn, COALESCE(d.name, n.name) AS name, d.paidst AS dp, n.paidst AS np, sp.name AS dept "
            "FROM opitemrece oi JOIN ovst o ON o.vn = oi.vn "
            "LEFT JOIN spclty sp ON sp.spclty = o.spclty "
            "LEFT JOIN drugitems d ON d.icode = oi.icode "
            "LEFT JOIN nondrugitems n ON n.icode = oi.icode "
            f"WHERE oi.vn IN :vns AND {opd} AND oi.paidst = '02'")
        for r in rows:
            name = str(r["name"] or "").strip()
            master = str(r["dp"] or "").strip() or str(r["np"] or "").strip()
            if master == "03":
                why = "ทะเบียนตั้งเป็นชำระเองเบิกไม่ได้ (03)"
            elif "เบิกไม่ได้" in name:
                why = "ชื่อรายการระบุว่าเบิกไม่ได้"
            elif _CHECKUP_RE.search(name) and "ตรวจสุขภาพ" not in str(r["dept"] or ""):
                # ชุดตรวจสุขภาพเบิกได้ใน visit ตรวจสุขภาพ (สิทธิ บก./อปท.) — ผิดเมื่อผูกไปใช้ใน visit รักษา
                why = "เป็นรายการชุดตรวจสุขภาพแต่ใช้ใน visit รักษา (ต้องลบแล้วบันทึกรายการปกติ)"
            else:
                continue
            add(r["vn"], _issue("PAY01", "AMOUNT", "paidst",
                                f"{name} คิดเป็นลูกหนี้สิทธิ (02) แต่{why} — ลบแล้วบันทึกใหม่ให้ถูกประเภท",
                                current_value="02"), dedup_key=name)
    except Exception:
        _rollback(conn); skipped.append("PAY01 ประเภทการชำระ")

    # Q04 — อวัยวะเทียม/อุปกรณ์หมวด 2 ในผู้ป่วยนอก
    try:
        for r in q("SELECT oi.vn, n.name FROM opitemrece oi JOIN nondrugitems n ON n.icode = oi.icode "
                   f"WHERE oi.vn IN :vns AND {opd} AND oi.paidst = '02' AND oi.income = '02'"):
            name = str(r["name"] or "").strip()
            hard = bool(_OR_IMPLANT_RE.search(name))
            if not hard and ("เบิกได้" in name or "ฟันเทียม" in name):
                continue   # รายการที่ทะเบียนระบุว่าเบิกในผู้ป่วยนอกได้
            add(r["vn"], _issue("Q04", "AMOUNT", "income",
                                f"{name} เป็นอวัยวะเทียม/อุปกรณ์หมวด 2 ในผู้ป่วยนอก — "
                                + ("อุปกรณ์ที่ใช้ในห้องผ่าตัดเบิกในผู้ป่วยนอกไม่ได้ (Q04)" if hard
                                   else "ตรวจว่าเบิกในผู้ป่วยนอกได้ตามระเบียบ และมีเหตุผล/ข้อบ่งชี้"),
                                severity="ERROR" if hard else "WARNING"), dedup_key=name)
    except Exception:
        _rollback(conn); skipped.append("Q04 อุปกรณ์หมวด 2")

    # G06 — ยาเบิกได้ที่ไม่มี TMT
    try:
        for r in q("SELECT DISTINCT oi.vn, d.name FROM opitemrece oi JOIN drugitems d ON d.icode = oi.icode "
                   f"WHERE oi.vn IN :vns AND {opd} AND oi.paidst = '02' "
                   "AND COALESCE(TRIM(d.tmt_tp_code), '') = ''"):
            name = str(r["name"] or "").strip()
            add(r["vn"], _issue("G06", "DRUG", "tmt_tp_code",
                                f"{name} ไม่มีรหัส TMT ในทะเบียนยา — แจ้งเภสัชเติม TMT (ติด C G06/G07)",
                                severity="INFO"), dedup_key=name)
    except Exception:
        _rollback(conn); skipped.append("G06 TMT ยา")

    # L01 — lab เบิกได้ที่ไม่มี TMLT
    try:
        # รายการค่าใช้จ่าย 1 ตัว (icode) ผูก lab ย่อยได้หลายตัว (เช่น CBC) — ถือว่ามี TMLT ถ้าตัวใดตัวหนึ่งมี
        for r in q("SELECT DISTINCT oi.vn, n.name "
                   "FROM opitemrece oi JOIN nondrugitems n ON n.icode = oi.icode "
                   f"WHERE oi.vn IN :vns AND {opd} AND oi.paidst = '02' "
                   "AND EXISTS (SELECT 1 FROM lab_items li WHERE li.icode = oi.icode) "
                   "AND NOT EXISTS (SELECT 1 FROM lab_items li WHERE li.icode = oi.icode "
                   "                AND COALESCE(TRIM(li.tmlt_code), '') <> '') "
                   "AND COALESCE(TRIM(n.sks_tmlt_code), '') = ''"):
            name = str(r["name"] or "").strip()
            add(r["vn"], _issue("L01", "LAB", "tmlt_code",
                                f"{name} ไม่มีรหัส TMLT — แจ้งแผนก lab เติมรหัส (ติด C L01/L02)",
                                severity="WARNING"), dedup_key=name)
    except Exception:
        _rollback(conn); skipped.append("L01 TMLT lab")

    # S48 — แพทย์ผู้ตรวจไม่มีเลขใบประกอบ
    try:
        for r in q("SELECT o.vn, e.name, e.licenseno FROM ovst o JOIN doctor e ON e.code = o.doctor "
                   "WHERE o.vn IN :vns"):
            if not _LICENSE_RE.search(str(r["licenseno"] or "")):
                add(r["vn"], _issue("S48", "DOCTOR", "doctor.licenseno",
                                    f"แพทย์ผู้ตรวจ {str(r['name'] or '').strip()} ไม่มีเลขใบประกอบวิชาชีพ (ว.) "
                                    "ในทะเบียน — ไฟล์ส่งเบิกจะติด C S48",
                                    current_value=str(r["licenseno"] or "") or None))
    except Exception:
        _rollback(conn); skipped.append("S48 เลข ว. แพทย์")

    # C05 — visit คนเดียวกัน วัน-เวลาเดียวกัน (ระดับนาที) ทั้งคู่มีรายการเบิก
    try:
        meta = {str(v["vn"]): v for v in visits}
        tset = {str(v) for v in target}
        hns = sorted({str(meta[vn].get("hn") or "") for vn in tset if vn in meta} - {""})
        days = sorted({meta[vn].get("vstdate") for vn in tset if vn in meta} - {None})
        if hns and days:
            rows = conn.execute(text(
                "SELECT o.vn, o.hn, o.vstdate, o.vsttime FROM ovst o "
                "WHERE o.hn IN :hns AND o.vstdate IN :days AND (o.an IS NULL OR o.an = '') "
                "AND EXISTS (SELECT 1 FROM opitemrece x WHERE x.vn = o.vn AND x.paidst = '02')"
            ).bindparams(bindparam("hns", expanding=True), bindparam("days", expanding=True)),
                {"hns": hns, "days": days}).mappings().all()
            groups: dict[tuple, list] = {}
            for r in rows:
                key = (str(r["hn"]), str(r["vstdate"]), str(r["vsttime"] or "")[:5])
                groups.setdefault(key, []).append(str(r["vn"]))
            for (_hn, _d, hhmm), vs in groups.items():
                if len(vs) < 2:
                    continue
                for vn in vs:
                    if vn in tset:
                        others = ", ".join(x for x in vs if x != vn)
                        add(vn, _issue("C05", "DUPLICATE", "vsttime",
                                       f"มี visit อื่นของผู้ป่วยรายนี้เวลาเดียวกัน ({hhmm} น. · VN {others}) — "
                                       "ส่งเบิกจะติด C05 ซ้ำซ้อน แก้เวลาเข้ารับบริการให้ต่างกันอย่างน้อย 1 นาที",
                                       severity="WARNING", current_value=hhmm))
    except Exception:
        _rollback(conn); skipped.append("C05 visit เวลาซ้ำ")

    return issues, skipped
