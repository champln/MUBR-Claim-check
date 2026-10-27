"""
ดึงข้อมูลผู้ป่วยในจากฐาน HOSxP มาตรวจแบบ Pre-screen สด (แยกจากผู้ป่วยนอก — ดึงเฉพาะเมื่อเปิดหน้าผู้ป่วยใน)

โหมด
  discharged : จำหน่ายแล้วในช่วงวันที่ (ชุดที่จะส่งเบิก CIPN/AIPN)
  admitted   : ยังนอนอยู่ (ยังไม่จำหน่าย) — ตรวจล่วงหน้าเช่นเลขอนุมัตินอนโรงพยาบาล / ส่วนเกิน

ตาราง HOSxP ที่ใช้
  ipt          : an, hn, vn, regdate/regtime, dchdate/dchtime, pttype, ward, spclty, admdoctor,
                 dch_doctor, drg, rw, adjrw
  patient      : cid, ชื่อ, วันเกิด, เพศ
  an_stat      : admdate (วันนอนจริง), item_money (ค่าใช้จ่ายรวม), pdx (สำรอง)
  iptdiag      : icd10, diagtype ('1' = โรคหลัก)
  ipt_pttype   : auth_code (เลขอนุมัตินอนโรงพยาบาล -> CIPN ClaimAuth/AuthCode)
  opitemrece + nondrugitems : รายการชำระส่วนเกินที่โอนติดมา (an = ผู้ป่วยรายนี้)
  pttype / ward / spclty / doctor : ชื่อสำหรับแสดงผล
"""
from __future__ import annotations

import re
from datetime import date
from typing import Any, Optional

from sqlalchemy import bindparam, text

from services.hosxp_live_source import HosxpLiveSourceError, _engine, _issue, _rollback

# รายการชำระส่วนเกิน — ใน HOSxP ตั้งชื่อหลายแบบ: [ชำระส่วนเกิน] X / X [ชำระเงิน-ส่วนเกิน] / X (ชำระเงิน/ส่วนเกิน) / X [ส่วนเกิน]
EXCESS_NAME_LIKE = "%ส่วนเกิน%"
# หมวด (income) ที่ระเบียบ IPD ให้เก็บส่วนเกินได้: 01 ค่าห้อง/อาหาร, 02 อวัยวะเทียม/อุปกรณ์บำบัด
EXCESS_ALLOWED_INCOME = {"01", "02"}
# สิทธิที่ส่งเบิกผู้ป่วยในด้วย CIPN (กรมบัญชีกลาง) — ต้องมีเลขอนุมัตินอนโรงพยาบาล
CIPN_HIPDATA = {"OFC"}

# ClaimCat ในทะเบียนรายการ (nondrugitems.csmbs_claim_cat) — ไฟล์ CIPN ดึงค่านี้ไปตรงๆ
# เบิกแยกนอก DRG (T) ได้เฉพาะหมวด 01 ค่าห้อง/อาหาร และ 02 อวัยวะเทียม/อุปกรณ์บำบัด
# รายการหมวดอื่นที่ตั้งเป็น T ทำให้ XDRGClaim ผิด -> ติด C 36 (เช่น Hypo-hyperthermia, oral airway)
CLAIMCAT_T_INCOME = {"01", "02"}

# กฎที่ใช้ได้เฉพาะเมื่อจำหน่ายแล้ว — โหมด "ยังนอนอยู่" ไม่ต้องตรวจ
DISCHARGE_ONLY_CODES = {"DATE003", "DATE004", "DRG001", "DRG002", "ICD001", "ICD005", "AMT001", "ROOM02"}

# ── ค่าห้องตามกลุ่มสิทธิ (เกณฑ์ ศกพ.) — ROOM01 ราคา/การแยกส่วนเกิน · ROOM02 จำนวนคืนไม่ตรงวันนอน ──
#   ห้องพิเศษ ศกพ.คิด 1,400 · เบิกจ่ายตรง (กบก./อปท./กทม.) เบิก 1,000 นอก DRG (T) ส่วนเกิน 400
#                            · ปกส.รามา พนง. เบิก 400 รวมใน DRG (D) ส่วนเกิน 1,000
#   ห้องสามัญ ศกพ.คิด   500 · เบิกจ่ายตรง เบิก 400 นอก DRG (T) ส่วนเกิน 100
#                            · ปกส.รามา เบิก 400 รวมใน DRG (D) ส่วนเกิน 100
ROOM_ITEMS = {
    "3004319": {"kind": "special", "label": "ห้องพิเศษ"},
    "3004317": {"kind": "general", "label": "ห้องสามัญ"},
}
ROOM_RULES = {
    # (กลุ่มสิทธิ, ประเภทห้อง): (ราคาเบิก/คืน, ClaimCat, {icode รายการส่วนเกินที่ถูก: ราคา})
    ("direct", "special"): (1000, "T", {"3004321": 400}),
    ("direct", "general"): (400, "T", {"3004318": 100}),
    ("sso_rama", "special"): (400, "D", {"3008823": 1000}),
    ("sso_rama", "general"): (400, "D", {"3008822": 100}),
}
ROOM_EXCESS_ICODES = {"3004321", "3004318", "3008823", "3008822"}
DIRECT_HIPDATA = {"OFC", "LGO", "BKK"}
PAYER_LABEL = {"direct": "สิทธิเบิกจ่ายตรง", "sso_rama": "ปกส.รามา พนักงาน"}


def room_payer(hipdata: str, pttype_name: str) -> str:
    hip = hipdata.upper()
    if hip in DIRECT_HIPDATA:
        return "direct"
    if hip == "SSS" and "รามา" in pttype_name:
        return "sso_rama"
    return ""


def _room_issues(rows: list, payer: str, los: Any, discharged: bool) -> list:
    """rows = [{icode, unitprice, paidst, qty}] ของค่าห้องหลัก + ส่วนเกินค่าห้อง ใน AN เดียว"""
    out: list = []
    if not payer:
        return out
    who = PAYER_LABEL[payer]
    main_qty = 0.0
    excess_qty: dict[str, float] = {}
    for r in rows:
        ic = _s(r["icode"])
        qty = float(r["qty"] or 0)
        if ic in ROOM_EXCESS_ICODES:
            excess_qty[ic] = excess_qty.get(ic, 0) + qty
    # รายการส่วนเกินค่าห้องของอีกกลุ่มสิทธิ (เช่น ปกส.รามา ใช้ 3004321 ของเบิกจ่ายตรง)
    payer_codes = {k for (p, _), (_, _, ex) in ROOM_RULES.items() if p == payer for k in ex}
    wrong_codes = sorted(x for x, q in excess_qty.items() if q > 0 and x not in payer_codes)
    if wrong_codes and any(_s(r["icode"]) in ROOM_ITEMS for r in rows):
        right = sorted({f"{k} ({v:,} บาท)" for (p, _), (_, _, ex) in ROOM_RULES.items() if p == payer
                        for k, v in ex.items()})
        out.append(_issue(
            "ROOM01", "AMOUNT", "room_excess",
            f"{who}: ใช้รายการส่วนเกินค่าห้องของอีกกลุ่มสิทธิ (รหัส {', '.join(wrong_codes)}) — "
            f"กลุ่มนี้ใช้รหัส {', '.join(right)}",
            severity="WARNING"))
    for r in rows:
        ic = _s(r["icode"])
        item = ROOM_ITEMS.get(ic)
        if not item:
            continue
        rate, cat, excess_ok = ROOM_RULES[(payer, item["kind"])]
        up = float(r["unitprice"] or 0)
        qty = float(r["qty"] or 0)
        paid = _s(r["paidst"])
        main_qty += qty
        if paid == "03":
            continue   # ผู้ป่วยชำระเองทั้งหมด ไม่ได้ส่งเบิก
        rule = (f"{item['label']} {who} เบิกได้คืนละ {rate:,} บาท "
                + ("นอก DRG (ClaimCat T)" if cat == "T" else "รวมใน DRG (ClaimCat D)"))
        if abs(up - rate) > 0.01:
            out.append(_issue(
                "ROOM01", "AMOUNT", "room_price",
                f"{rule} แต่คิดเป็นลูกหนี้คืนละ {up:,.0f} บาท ({qty:,.0f} คืน) — "
                + ("ส่วนที่เกินต้องแยกเป็นรายการชำระส่วนเกินค่าห้อง" if up > rate else "ราคาต่ำกว่าอัตราเบิก ตรวจรายการค่าห้อง"),
                severity="ERROR" if up > rate else "WARNING", current_value=f"{up:,.0f}"))
        got = sum(excess_qty.get(x, 0) for x in excess_ok)
        if got + 0.001 < qty and not wrong_codes:
            out.append(_issue(
                "ROOM01", "AMOUNT", "room_excess",
                f"{rule} — ส่วนเกินค่าห้อง {', '.join(f'{v:,} บาท' for v in excess_ok.values())}/คืน "
                f"คิดไว้ {got:,.0f} คืน จาก {qty:,.0f} คืน (ศกพ.คิดเต็มราคา ส่วนต่างต้องเก็บเป็นชำระส่วนเกิน)",
                severity="WARNING", current_value=f"{got:,.0f}/{qty:,.0f}"))
    if discharged and main_qty and los is not None:
        try:
            nights = float(los)
        except (TypeError, ValueError):
            nights = None
        if nights is not None and abs(main_qty - nights) > 0.001 and nights > 0:
            out.append(_issue(
                "ROOM02", "AMOUNT", "room_qty",
                f"ค่าห้องคิด {main_qty:,.0f} คืน แต่วันนอน {nights:,.0f} วัน — ตรวจจำนวนคืนค่าห้อง",
                severity="WARNING", current_value=f"{main_qty:,.0f}"))
    return out


def _rows(conn, sql: str, params: dict, expand: tuple = ()) -> list:
    stmt = text(sql)
    for name in expand:
        stmt = stmt.bindparams(bindparam(name, expanding=True))
    return [dict(r) for r in conn.execute(stmt, params).mappings().all()]


def _optional(conn, sql: str, params: dict, expand: tuple = ()) -> list:
    """query เสริม — ดึงไม่ได้ (คอลัมน์/สิทธิ์ต่างจากมาตรฐาน) ก็คืนว่าง ไม่ทำให้ทั้งหน้าล้ม"""
    try:
        return _rows(conn, sql, params, expand)
    except Exception:
        _rollback(conn)
        return []


def _s(v: Any) -> str:
    return str(v or "").strip()


def fetch_live_ipd_records(
    db_url: str,
    mode: str = "discharged",
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    limit: int = 300,
) -> list[dict[str, Any]]:
    limit = max(1, min(int(limit or 300), 1000))
    sql = """
        SELECT i.an, i.hn, i.vn, i.regdate, i.regtime, i.dchdate, i.dchtime, i.pttype, i.ward, i.spclty,
               i.admdoctor, i.dch_doctor, i.drg, i.rw, i.adjrw,
               p.cid, p.pname, p.fname, p.lname, p.birthday, p.sex
        FROM ipt i JOIN patient p ON p.hn = i.hn
    """
    params: dict[str, Any] = {"lim": limit}
    if mode == "admitted":
        sql += " WHERE i.dchdate IS NULL ORDER BY i.regdate DESC, i.an DESC LIMIT :lim"
    else:
        sql += " WHERE i.dchdate BETWEEN :d1 AND :d2 ORDER BY i.dchdate DESC, i.an DESC LIMIT :lim"
        params.update(d1=date_from, d2=date_to)

    try:
        with _engine(db_url).connect() as conn:
            adms = _rows(conn, sql, params)
            if not adms:
                return []
            ans = [a["an"] for a in adms]
            q = {"ans": ans}

            stat = {_s(r["an"]): r for r in _optional(
                conn, "SELECT an, admdate, item_money, pdx FROM an_stat WHERE an IN :ans", q, ("ans",))}
            dx_rows = _optional(conn, "SELECT an, icd10, diagtype FROM iptdiag WHERE an IN :ans "
                                      "ORDER BY an, diagtype", q, ("ans",))
            auth = {}
            for r in _optional(conn, "SELECT an, auth_code FROM ipt_pttype WHERE an IN :ans", q, ("ans",)):
                if _s(r["auth_code"]) or _s(r["an"]) not in auth:
                    auth[_s(r["an"])] = _s(r["auth_code"])
            excess = _optional(
                conn,
                "SELECT oi.an, n.name, n.income, SUM(oi.sum_price) AS amount "
                "FROM opitemrece oi JOIN nondrugitems n ON n.icode = oi.icode "
                "WHERE oi.an IN :ans AND n.name LIKE :ex GROUP BY oi.an, n.name, n.income",
                {**q, "ex": EXCESS_NAME_LIKE}, ("ans",))

            claimcat_t = _optional(
                conn,
                "SELECT oi.an, n.icode, n.name, n.income, SUM(oi.qty) AS qty "
                "FROM opitemrece oi JOIN nondrugitems n ON n.icode = oi.icode "
                "WHERE oi.an IN :ans AND n.csmbs_claim_cat = 'T' "
                "AND COALESCE(n.income, '') NOT IN ('01', '02') "
                "GROUP BY oi.an, n.icode, n.name, n.income",
                q, ("ans",))

            rooms = _optional(
                conn,
                "SELECT oi.an, oi.icode, oi.unitprice, oi.paidst, SUM(oi.qty) AS qty "
                "FROM opitemrece oi WHERE oi.an IN :ans AND oi.icode IN :rc "
                "GROUP BY oi.an, oi.icode, oi.unitprice, oi.paidst",
                {**q, "rc": sorted(set(ROOM_ITEMS) | ROOM_EXCESS_ICODES)}, ("ans", "rc"))

            ned_ef = _optional(
                conn,
                "SELECT DISTINCT n.an, d.name AS drug_name "
                "FROM ipt_presc_ned n "
                "JOIN opitemrece oi ON oi.an = n.an AND oi.icode = n.icode "
                "LEFT JOIN drugitems d ON d.icode = n.icode "
                "LEFT JOIN drugitems_ned_reason_list l ON l.doctor_reason = n.presc_reason_1 "
                "WHERE n.an IN :ans AND oi.paidst = '02' AND l.claim_control = 'EF'",
                q, ("ans",))

            codes = lambda k: sorted({_s(a[k]) for a in adms} - {""})  # noqa: E731
            pt = {_s(r["pttype"]): r for r in _optional(
                conn, "SELECT pttype, name, hipdata_code FROM pttype WHERE pttype IN :c",
                {"c": codes("pttype")}, ("c",))} if codes("pttype") else {}
            wards = {_s(r["ward"]): _s(r["name"]) for r in _optional(
                conn, "SELECT ward, name FROM ward WHERE ward IN :c", {"c": codes("ward")}, ("c",))} \
                if codes("ward") else {}
            sps = {_s(r["spclty"]): _s(r["name"]) for r in _optional(
                conn, "SELECT spclty, name FROM spclty WHERE spclty IN :c", {"c": codes("spclty")}, ("c",))} \
                if codes("spclty") else {}
            doc_codes = sorted({_s(a[k]) for a in adms for k in ("admdoctor", "dch_doctor")} - {""})
            docs = {_s(r["code"]): _s(r["name"]) for r in _optional(
                conn, "SELECT code, name FROM doctor WHERE code IN :c", {"c": doc_codes}, ("c",))} \
                if doc_codes else {}
    except HosxpLiveSourceError:
        raise
    except Exception as e:
        raise HosxpLiveSourceError(f"อ่านข้อมูลผู้ป่วยในจาก HOSxP ไม่สำเร็จ: {e}")

    # วินิจฉัย — ตัดรหัสหัตถการ (ตัวเลขล้วน) ออกเหมือนฝั่งผู้ป่วยนอก
    dx: dict[str, dict[str, list]] = {}
    for r in dx_rows:
        code = _s(r["icd10"])
        if not code or not code[0].isalpha():
            continue
        slot = dx.setdefault(_s(r["an"]), {"pdx": [], "adx": []})
        (slot["pdx"] if _s(r["diagtype"]) == "1" else slot["adx"]).append(code)

    ned_ef_by_an: dict[str, list] = {}
    for r in ned_ef:
        ned_ef_by_an.setdefault(_s(r["an"]), []).append(r)

    claimcat_by_an: dict[str, list] = {}
    for r in claimcat_t:
        claimcat_by_an.setdefault(_s(r["an"]), []).append(r)

    excess_by_an: dict[str, list] = {}
    for r in excess:
        excess_by_an.setdefault(_s(r["an"]), []).append(r)

    rooms_by_an: dict[str, list] = {}
    for r in rooms:
        rooms_by_an.setdefault(_s(r["an"]), []).append(r)

    today = date.today()
    out: list[dict[str, Any]] = []
    for a in adms:
        an = _s(a["an"])
        st = stat.get(an, {})
        d = dx.get(an, {"pdx": [], "adx": []})
        ptr = pt.get(_s(a["pttype"]), {})
        regdate, dchdate = a.get("regdate"), a.get("dchdate")
        # an_stat.admdate = จำนวนวันนอนจริง (an_stat.los เป็นวันนอนเฉลี่ยของ DRG ไม่ใช่ของผู้ป่วย)
        los = st.get("admdate")
        if los is None and regdate and dchdate:
            los = (dchdate - regdate).days
        birthday = a.get("birthday")
        age = None
        if birthday:
            try:
                age = today.year - birthday.year - ((today.month, today.day) < (birthday.month, birthday.day))
            except Exception:
                age = None
        pdx = d["pdx"][0] if d["pdx"] else (_s(st.get("pdx")) or None)
        name = f"{_s(a['pname'])}{_s(a['fname'])} {_s(a['lname'])}".strip()

        issues: list[dict] = []
        # 31 — สิทธิกรมบัญชีกลางต้องมีเลขอนุมัตินอนโรงพยาบาล (CIPN ClaimAuth/AuthCode)
        if _s(ptr.get("hipdata_code")).upper() in CIPN_HIPDATA:
            code = auth.get(an, "")
            if not code:
                issues.append(_issue(
                    "31", "RIGHTS", "auth_code",
                    "สิทธิกรมบัญชีกลางแต่ยังไม่มีเลขอนุมัตินอนโรงพยาบาล — ไฟล์ CIPN จะติด 31 (empty AuthCode)",
                    severity="ERROR" if dchdate else "WARNING"))
            elif code != code.upper() or not re.fullmatch(r"[A-Za-z0-9]{4,20}", code):
                issues.append(_issue(
                    "31", "RIGHTS", "auth_code",
                    "เลขอนุมัตินอนโรงพยาบาลต้องเป็นตัวอักษรอังกฤษพิมพ์ใหญ่/ตัวเลข", current_value=code))
        # ส่วนเกิน — IPD เหมาจ่าย DRG เก็บส่วนเกินไม่ได้ (ยกเว้นห้อง/อาหาร และอวัยวะเทียม)
        for x in excess_by_an.get(an, []):
            income = _s(x["income"])
            amt = float(x["amount"] or 0)
            # ส่วนเกินค่าห้องพิเศษ/อวัยวะเทียม (หมวด 01/02) เก็บได้ตามระเบียบ — ไม่เตือน
            if amt <= 0 or income in EXCESS_ALLOWED_INCOME:
                continue
            issues.append(_issue(
                "ส่วนเกิน", "AMOUNT", "excess",
                f"มีรายการ {_s(x['name'])} {amt:,.2f} บาท — ผู้ป่วยในเหมาจ่าย DRG เก็บส่วนเกินไม่ได้ "
                "ต้องลบออกและคิดรายการหลักตามราคา Lab Catalog (CIPN จะติด C)",
                current_value=f"{amt:,.2f}"))

        # G04 — ยานอกบัญชีเหตุผล EF (เบิกไม่ได้) แต่คิดเป็นลูกหนี้สิทธิ
        for x in ned_ef_by_an.get(an, []):
            issues.append(_issue(
                "G04", "DRUG", "ned_reason",
                f"ยา {_s(x['drug_name'])} เหตุผลการใช้ยานอกบัญชีเป็น EF (ผู้ป่วยแสดงความจำนง = เบิกไม่ได้) "
                "แต่คิดเป็นลูกหนี้สิทธิ — เปลี่ยนเหตุผลตามที่แพทย์สรุป หรือเปลี่ยนเป็นชำระเอง"))

        # ค่าห้องตามกลุ่มสิทธิ (เกณฑ์ ศกพ.)
        issues.extend(_room_issues(
            rooms_by_an.get(an, []),
            room_payer(_s(ptr.get("hipdata_code")), _s(ptr.get("name"))),
            los, bool(dchdate)))

        # ClaimCat T นอกหมวด 01/02 -> CIPN มักติด 36
        for x in claimcat_by_an.get(an, []):
            issues.append(_issue(
                "CLAIMCAT", "DRG", "claim_cat",
                f"{_s(x['name'])} (รหัส {_s(x['icode'])} หมวด {_s(x['income'])}) ทะเบียน HOSxP ตั้ง ClaimCat = T "
                "(เบิกแยกนอก DRG) แต่ไม่ใช่หมวดห้อง/อวัยวะเทียม — CIPN มักติด 36 ควรเป็น D "
                "(แก้ทะเบียนใน HOSxP หรือแก้ในเมนู ClaimCat ผู้ป่วยใน)",
                severity="WARNING", current_value="T"))

        out.append({
            "claim_no": an,
            "an": an,
            "vn": _s(a.get("vn")),
            "hn": _s(a.get("hn")) or None,
            "pid": _s(a.get("cid")) or None,
            "patient_name": name or None,
            "dob": str(birthday) if birthday else None,
            "age": age,
            "visit_type": "IPD",
            "visit_date": str(regdate) if regdate else None,
            "regtime": _s(a.get("regtime")),
            "discharge_date": str(dchdate) if dchdate else None,
            "dchtime": _s(a.get("dchtime")),
            "los": los,
            "pdx": pdx,
            **{f"adx{i}": c for i, c in enumerate(d["adx"][:4], start=1)},
            "drg_code": _s(a.get("drg")) or None,
            "rw": float(a["adjrw"]) if a.get("adjrw") is not None else (float(a["rw"]) if a.get("rw") is not None else None),
            "total_charge": float(st.get("item_money") or 0),
            "pttype": _s(a.get("pttype")),
            "pttype_name": _s(ptr.get("name")),
            "claim_type": " ".join(x for x in (_s(a.get("pttype")), _s(ptr.get("name"))) if x) or None,
            "ward_name": wards.get(_s(a.get("ward")), _s(a.get("ward"))),
            "spclty_name": sps.get(_s(a.get("spclty")), _s(a.get("spclty"))),
            "admit_doctor_name": docs.get(_s(a.get("admdoctor")), ""),
            "dch_doctor_name": docs.get(_s(a.get("dch_doctor")), ""),
            "auth_code": auth.get(an, ""),
            "file_rule_issues": issues,
        })
    return out


# ─── รายงานทะเบียนรายการที่ ClaimCat น่าสงสัย (ส่งให้ BMS/IT แก้ที่ต้นทางครั้งเดียว) ─────
CLAIMCAT_KINDS = {
    "T_OUTSIDE": "ตั้งเป็น T แต่ไม่ใช่หมวด 01/02 — ควรเป็น D (เสี่ยงติด 36)",
    "D_ROOM": "หมวด 01/02 (ห้อง/อวัยวะเทียม) แต่ตั้งเป็น D — ควรเป็น T",
    "EMPTY": "ยังไม่ได้ตั้ง ClaimCat (ไฟล์ CIPN ออกเป็น D — ถูกแล้วสำหรับหมวดอื่นนอกจาก 01/02)",
}


def claimcat_master_report(db_url: str, since: date) -> dict:
    """
    รายการค่ารักษา (nondrugitems ที่เปิดใช้งาน) ที่ ClaimCat น่าสงสัย + จำนวนครั้งที่ใช้กับผู้ป่วยใน
    ตั้งแต่วันที่ since — อ่านเฉพาะทะเบียนรายการและจำนวนการใช้ ไม่อ่านข้อมูลผู้ป่วย
    """
    try:
        with _engine(db_url).connect() as conn:
            items = _rows(conn, """
                SELECT n.icode, n.name, n.income, n.csmbs_claim_cat AS claim_cat, n.price, i.name AS income_name
                FROM nondrugitems n LEFT JOIN income i ON i.income = n.income
                WHERE COALESCE(n.istatus, 'Y') = 'Y'
                  AND ((n.csmbs_claim_cat = 'T' AND COALESCE(n.income, '') NOT IN ('01', '02'))
                    OR (n.csmbs_claim_cat = 'D' AND n.income IN ('01', '02'))
                    OR COALESCE(TRIM(n.csmbs_claim_cat), '') = '')
            """, {})
            usage = {_s(r["icode"]): r for r in _optional(conn, """
                SELECT icode, COUNT(DISTINCT an) AS n_an, SUM(qty) AS qty, MAX(rxdate) AS last_used
                FROM opitemrece WHERE an IS NOT NULL AND rxdate >= :since GROUP BY icode
            """, {"since": since})}
    except Exception as e:
        raise HosxpLiveSourceError(f"อ่านทะเบียนรายการจาก HOSxP ไม่สำเร็จ: {e}")

    out = []
    for it in items:
        cat = _s(it["claim_cat"]).upper()
        income = _s(it["income"])
        kind = "EMPTY" if not cat else ("D_ROOM" if cat == "D" else "T_OUTSIDE")
        u = usage.get(_s(it["icode"]), {})
        out.append({
            "icode": _s(it["icode"]), "name": _s(it["name"]), "income": income,
            "income_name": _s(it["income_name"]), "claim_cat": cat, "price": float(it["price"] or 0),
            "kind": kind, "kind_label": CLAIMCAT_KINDS[kind],
            "ipd_admissions": int(u.get("n_an") or 0), "ipd_qty": float(u.get("qty") or 0),
            "last_used": str(u["last_used"]) if u.get("last_used") else None,
        })
    out.sort(key=lambda x: (-x["ipd_admissions"], x["kind"], x["icode"]))
    return {"since": str(since), "items": out,
            "counts": {k: sum(1 for x in out if x["kind"] == k) for k in CLAIMCAT_KINDS},
            "used_counts": {k: sum(1 for x in out if x["kind"] == k and x["ipd_admissions"]) for k in CLAIMCAT_KINDS}}
