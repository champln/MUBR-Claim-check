"""
ตรวจและแก้ไฟล์ผู้ป่วยใน CIPN/AIPN ตามสเปก สกส. (CSMBS In-patient Claim v2.0)

เน้นเรื่องที่ทำให้ถูกตีกลับบ่อย โดยเฉพาะ ClaimCat ที่ไม่ตรงเงื่อนไขการเบิก
ซึ่งทำให้ยอด DRGCharge / XDRGClaim ผิดตามไปด้วย

สูตรยอดรวม (สเปก Table 12):
    net_i     = ChargeAmt_i - Discount_i
    DRGCharge = ผลรวม net_i        ของแถวที่ ClaimCat = 'D'
    XDRGClaim = ผลรวม min(ClaimAmt_i, net_i) ของแถวที่ ClaimCat = 'T'

รหัสตีกลับที่เกี่ยวข้อง
    35  ผลรวม DRGCharge ไม่ถูกต้อง
    36  ผลรวม XDRGClaim ไม่ถูกต้อง (บั๊กของ HOSxP: รวม ChargeAmt แทน min(ClaimAmt, net))
    30  รูปแบบไฟล์ไม่ถูกต้อง
    22  ค่า HMAC ไม่ตรงกับเนื้อไฟล์
"""
import re
from decimal import Decimal, InvalidOperation
from typing import Dict, List, Optional

from services.aipn_signer import compute_cipn_md5
from services.aipn_signer import verify as verify_hmac
from services.csop_file_editor import ENCODING

# ── ตำแหน่งฟิลด์ BillItems (0-based) ตามสเปก ─────────────────────────────────
F_SEQ, F_SERVDATE, F_BILLGR, F_LCCODE, F_DESC = 0, 1, 2, 3, 4
F_QTY, F_UNITPRICE, F_CHARGEAMT, F_DISCOUNT = 5, 6, 7, 8
F_PROCSEQ, F_DIAGSEQ, F_CLAIMSYS, F_BILLGRCS, F_CSCODE = 9, 10, 11, 12, 13
F_CODESYS, F_STDCODE, F_CLAIMCAT, F_DATEREV, F_CLAIMUP, F_CLAIMAMT = 14, 15, 16, 17, 18, 19
BILLITEM_FIELDS = 20

VALID_CLAIMCAT = {"T", "D", "X"}
# หมวดที่เบิกแยกนอก DRG (เบิกตามราคาต่อหน่วย) = ห้อง/อาหาร และอวัยวะเทียม/อุปกรณ์
BILLGRCS_T = {"01", "02"}

_SECTION_RE = {
    "IPADT": re.compile(r"<IPADT[^>]*>\r?\n(.*?)</IPADT>", re.S),
    "IPDx": re.compile(r"<IPDx[^>]*>\r?\n(.*?)</IPDx>", re.S),
    "IPOp": re.compile(r"<IPOp[^>]*>\r?\n(.*?)</IPOp>", re.S),
    "BillItems": re.compile(r"<BillItems[^>]*>\r?\n(.*?)</BillItems>", re.S),
}
_RECCOUNT_RE = {k: re.compile(rf"<{k}[^>]*Reccount=\"(\d+)\"") for k in ("IPDx", "IPOp", "BillItems")}
_BAD_CHARS = set('<>"\'&')


def _dec(v: str) -> Optional[Decimal]:
    try:
        return Decimal((v or "").strip() or "0")
    except InvalidOperation:
        return None


def _rows(text: str, section: str) -> List[List[str]]:
    m = _SECTION_RE[section].search(text)
    if not m or not m.group(1).strip():
        return []
    return [l.split("|") for l in m.group(1).strip().splitlines() if l.strip()]


def _finding(code: str, severity: str, message: str, where: str = "", suggest: str = "") -> dict:
    return {"code": code, "severity": severity, "message": message, "where": where, "suggest": suggest}


def compute_totals(rows: List[List[str]]) -> Dict[str, Decimal]:
    """คำนวณ DRGCharge / XDRGClaim ตามสูตรของ สกส."""
    drg = xdrg = Decimal(0)
    for f in rows:
        if len(f) < BILLITEM_FIELDS:
            continue
        amt, disc = _dec(f[F_CHARGEAMT]), _dec(f[F_DISCOUNT])
        if amt is None or disc is None:
            continue
        net = amt - disc
        cat = f[F_CLAIMCAT].strip().upper()
        if cat == "D":
            drg += net
        elif cat == "T":
            claim = _dec(f[F_CLAIMAMT]) or Decimal(0)
            xdrg += min(claim, net)
    return {"drg_charge": drg, "xdrg_claim": xdrg}


# รายการ "ชำระส่วนเกิน" ที่ HOSxP โอนติดมาจากฝั่ง OPD — ผู้ป่วยจ่ายส่วนต่างเองแล้ว
# ชื่อใน HOSxP มีหลายแบบ: "[ชำระส่วนเกิน] Blood lactate", "Troponin I [ชำระเงิน-ส่วนเกิน]",
# "Aerobic culture (ชำระเงิน/ส่วนเกิน)", "Ferritin [ส่วนเกิน]" — จับเครื่องหมายในวงเล็บได้ทุกตำแหน่ง
EXCESS_MARK_RE = re.compile(r"\s*[\[(]\s*(?:ชำระ(?:เงิน)?\s*[-/]?\s*)?ส่วนเกิน\s*[\])]\s*")
EXCESS_PREFIX_RE = EXCESS_MARK_RE   # ชื่อเดิม (คงไว้ให้โค้ดที่อ้างถึง)


def is_excess_row(f: List[str]) -> bool:
    return len(f) > F_DESC and bool(EXCESS_MARK_RE.search(f[F_DESC]))


def find_main_row(bill: List[List[str]], excess: List[str]) -> Optional[List[str]]:
    """หารายการหลักของแถวส่วนเกิน: ชื่อเดียวกัน (ตัดคำนำหน้า) — วันเดียวกันก่อน"""
    norm = lambda t: " ".join(t.split()).lower()  # noqa: E731  ช่องว่างซ้อนในชื่อรายการ
    name = norm(EXCESS_MARK_RE.sub(" ", excess[F_DESC]))
    same = [f for f in bill if len(f) > F_DESC and not is_excess_row(f)
            and norm(f[F_DESC]) == name]
    same_day = [f for f in same if f[F_SERVDATE][:10] == excess[F_SERVDATE][:10]]
    return (same_day or same or [None])[0]


# เลขอนุมัตินอนโรงพยาบาล (ClaimAuth/AuthCode) จากเว็บ สกส. เช่น AB12CD (6 ตัว)
# ว่าง -> สกส. ตีกลับ 31 "11: empty AuthCode" (AN 660000010) — ต้องเป็นตัวพิมพ์ใหญ่
AUTH_CODE_RE = re.compile(r"^[A-Z0-9]{4,20}$")


def read_auth(raw: bytes) -> dict:
    """อ่าน AuthCode / AuthDT และวันเวลาที่ admit (IPADT ฟิลด์ 15) เพื่อใช้เทียบ"""
    text = raw.decode(ENCODING, "replace")
    code = re.search(r"<AuthCode>([^<]*)</AuthCode>", text)
    dt = re.search(r"<AuthDT>([^<]*)</AuthDT>", text)
    doc = (re.search(r"<DocSysID[^>]*>([^<]*)</DocSysID>", text) or [None, ""])[1].strip()
    ipadt = _rows(text, "IPADT")
    admit = ipadt[0][14].strip() if ipadt and len(ipadt[0]) > 14 else ""
    return {
        "doc": doc,
        "has_tag": code is not None,
        "auth_code": code.group(1).strip() if code else "",
        "auth_dt": dt.group(1).strip() if dt else "",
        "admit_dt": admit,
    }


def _auth_findings(raw: bytes) -> List[dict]:
    a = read_auth(raw)
    out: List[dict] = []
    if not a["has_tag"]:
        out.append(_finding("31", "ERROR", "ไม่พบแท็ก <AuthCode> ใน <ClaimAuth>", where="ClaimAuth"))
        return out
    code = a["auth_code"]
    if not code:
        # ไฟล์ AIPN หลายฉบับส่งโดยไม่มีเลขอนุมัติ — เตือนไว้ให้ตรวจตามสิทธิ ส่วน CIPN (กรมบัญชีกลาง) ต้องมี
        sev = "ERROR" if a["doc"].upper() == "CIPN" else "WARNING"
        out.append(_finding(
            "31", sev, "AuthCode ว่าง (ไม่มีเลขอนุมัตินอนโรงพยาบาล) — สกส. ตีกลับ 31: empty AuthCode",
            where="ClaimAuth", suggest="กรอกเลขอนุมัติจากเว็บ สกส."))
    elif not AUTH_CODE_RE.match(code):
        out.append(_finding(
            "31", "ERROR", f"AuthCode '{code}' ผิดรูปแบบ — ต้องเป็นตัวอักษรอังกฤษพิมพ์ใหญ่/ตัวเลข",
            where="ClaimAuth", suggest=f"แก้เป็น {re.sub(r'[^A-Za-z0-9]', '', code).upper()}"))
    if code and not a["auth_dt"]:
        out.append(_finding("31", "WARNING", "มี AuthCode แต่ AuthDT ว่าง", where="ClaimAuth",
                            suggest=f"ใช้วันเวลา admit {a['admit_dt']}" if a["admit_dt"] else ""))
    return out


def set_auth(raw: bytes, auth_code: str, auth_dt: str = "") -> tuple:
    """
    ตั้ง AuthCode (ตัดช่องว่าง + ตัวพิมพ์ใหญ่ + ตรวจรูปแบบ) และ AuthDT
    auth_dt ว่าง = คงค่าเดิม ถ้าเดิมว่างจะใช้วันเวลา admit (ไฟล์จริงทุกฉบับ AuthDT = วัน admit)
    คืน (ไบต์ใหม่, {before, after})
    """
    code = re.sub(r"\s+", "", auth_code or "").upper()
    if not AUTH_CODE_RE.match(code):
        raise ValueError(f"เลขอนุมัติ '{auth_code}' ไม่ถูกรูปแบบ — ต้องเป็นตัวอักษรอังกฤษ/ตัวเลข 4–20 ตัว")
    dt = (auth_dt or "").strip()
    if dt and not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}", dt):
        raise ValueError(f"AuthDT '{dt}' ต้องเป็นรูปแบบ YYYY-MM-DDTHH:MM:SS")
    before = read_auth(raw)
    if not before["has_tag"]:
        raise ValueError("ไม่พบแท็ก <AuthCode> ในไฟล์ — แก้ด้วยเมนูนี้ไม่ได้")
    dt = dt or before["auth_dt"] or before["admit_dt"]

    text = raw.decode(ENCODING)
    text = re.sub(r"<AuthCode>[^<]*</AuthCode>", f"<AuthCode>{code}</AuthCode>", text, count=1)
    if dt:
        text = re.sub(r"<AuthDT>[^<]*</AuthDT>", f"<AuthDT>{dt}</AuthDT>", text, count=1)
    new = text.encode(ENCODING)
    after = read_auth(new)
    return new, {"before": {"auth_code": before["auth_code"], "auth_dt": before["auth_dt"]},
                 "after": {"auth_code": after["auth_code"], "auth_dt": after["auth_dt"]}}


def remove_rows(raw: bytes, seqs: List[str]) -> tuple:
    """
    ลบแถว BillItems ตามลำดับ (seq) ที่ระบุ แล้ว
      - เลื่อนเลขลำดับของแถวถัดไปลงให้ต่อเนื่อง (59 -> 58 ...)
      - แก้ Reccount ของ BillItems
    (ยอดรวม/HMAC คำนวณใหม่ใน finalize) คืน (ไบต์ใหม่, รายการที่ลบ)
    """
    wanted = {str(s).strip() for s in seqs if str(s).strip()}
    if not wanted:
        return raw, []
    text = raw.decode(ENCODING)
    m = _SECTION_RE["BillItems"].search(text)
    if not m:
        raise ValueError("ไม่พบ BillItems ในไฟล์")
    lines = m.group(1).split("\r\n")
    removed: List[dict] = []
    deleted_nums: List[int] = []
    kept: List[str] = []
    for line in lines:
        f = line.split("|")
        if len(f) == BILLITEM_FIELDS and f[F_SEQ].strip() in wanted:
            removed.append({"seq": f[F_SEQ].strip(), "desc": f[F_DESC].strip(),
                            "charge_amt": f[F_CHARGEAMT].strip(), "claim_cat": f[F_CLAIMCAT].strip()})
            if f[F_SEQ].strip().isdigit():
                deleted_nums.append(int(f[F_SEQ]))
            continue
        kept.append(line)
    missing = wanted - {r["seq"] for r in removed}
    if missing:
        raise ValueError(f"ไม่พบแถวที่ {sorted(missing)} ใน BillItems")

    out_lines = []
    for line in kept:
        f = line.split("|")
        if len(f) == BILLITEM_FIELDS and f[F_SEQ].strip().isdigit():
            n = int(f[F_SEQ])
            f[F_SEQ] = str(n - sum(1 for d in deleted_nums if d < n))
            line = "|".join(f)
        out_lines.append(line)

    body = "\r\n".join(out_lines)
    text = text[:m.start(1)] + body + text[m.end(1):]
    n_rows = sum(1 for l in out_lines if len(l.split("|")) == BILLITEM_FIELDS)
    text = re.sub(r'(<BillItems[^>]*Reccount=")\d+(")', rf"\g<1>{n_rows}\g<2>", text, count=1)
    return text.encode(ENCODING), removed


def _fmt(v: Decimal) -> str:
    return f"{v.quantize(Decimal('0.0001')):.4f}"


# ── ค่าห้องและ ClaimCat (เกณฑ์ ศกพ.) ─────────────────────────────────────────────
#   ห้องพิเศษ  ศกพ.คิด 1,400/คืน · เบิกจ่ายตรง (กบก./อปท./กทม.) เบิก 1,000 นอก DRG (T)
#                                · ปกส.รามา พนง. เบิก 400 รวมใน DRG (D)
#   ห้องสามัญ  ศกพ.คิด   500/คืน · เบิกจ่ายตรง เบิก 400 นอก DRG (T) · ปกส.รามา เบิก 400 รวมใน DRG (D)
# รายการห้องรู้จากรหัส HOSxP (LCCode) หรือรหัสมาตรฐาน (CSCode) — ไม่นับแถว [ชำระส่วนเกิน]
ROOM_KINDS = {
    "special": {"label": "ห้องพิเศษ", "lccodes": {"3004319"}, "cscodes": {"21201"},
                "hosp_price": Decimal("1400"), "direct_up": Decimal("1000")},
    "general": {"label": "ห้องสามัญ", "lccodes": {"3004317"}, "cscodes": {"21101"},
                "hosp_price": Decimal("500"), "direct_up": Decimal("400")},
}
# ชื่อรายการที่ HOSxP ระบุว่าเบิกไม่ได้ / ใช้ไม่ตรงข้อบ่งชี้ -> ClaimCat X (ไม่ขอเบิก)
NOT_CLAIMABLE_RE = re.compile(r"เบิกไม่ได้|ไม่ตรงข้อบ่งชี้")
SSO_RAMA_ROOM_UP = Decimal("400")   # ปกส.รามา เบิกได้คืนละ 400 (รวมใน DRG)
RAMA_HMAIN = "13781"                # โรงพยาบาลรามาธิบดี — Hmain ของไฟล์ AIPN ประกันสังคมพนักงานรามา
PAYER_LABEL = {"direct": "สิทธิเบิกจ่ายตรง (กบก./อปท./กทม.)", "sso_rama": "ปกส.รามา พนักงาน"}


def payer_group(text: str) -> str:
    """
    กลุ่มสิทธิของไฟล์ — 'direct' = CIPN (เบิกจ่ายตรง), 'sso_rama' = AIPN ที่ Hmain เป็นรามาธิบดี
    ไม่รู้ = '' (ไม่ใช้กฏค่าห้อง)
    """
    doc = (re.search(r"<DocSysID[^>]*>([^<]*)</DocSysID>", text) or [None, ""])[1].strip().upper()
    hmain = (re.search(r"<Hmain>([^<]*)</Hmain>", text) or [None, ""])[1].strip()
    if doc == "CIPN":
        return "direct"
    if doc == "AIPN" and hmain == RAMA_HMAIN:
        return "sso_rama"
    return ""


def room_kind(f: List[str]) -> str:
    if len(f) < BILLITEM_FIELDS or is_excess_row(f):
        return ""
    lc, cs = f[F_LCCODE].strip(), f[F_CSCODE].strip()
    for kind, k in ROOM_KINDS.items():
        if lc in k["lccodes"] or cs in k["cscodes"]:
            return kind
    return ""


def room_expectation(kind: str, payer: str) -> Optional[tuple]:
    """(ClaimCat ที่ต้องเป็น, ClaimUP ที่ต้องเป็น, ราคาต่อหน่วยที่ควรเห็นในไฟล์ หรือ None)"""
    if not kind or not payer:
        return None
    if payer == "direct":
        return "T", ROOM_KINDS[kind]["direct_up"], None
    return "D", Decimal(0), SSO_RAMA_ROOM_UP


def validate(raw: bytes) -> dict:
    """ตรวจไฟล์ทั้งฉบับ — คืนรายการปัญหาพร้อมข้อเสนอแนะ (ไม่แก้ไฟล์)"""
    findings: List[dict] = []

    # โครงสร้างพื้นฐาน
    if b"<CIPN>" not in raw or b"</CIPN>" not in raw:
        return {"findings": [_finding("30", "ERROR", "ไม่พบ <CIPN>...</CIPN> ในไฟล์")], "rows": [],
                "totals": {}, "signature_ok": None, "can_fix": False}
    if not re.search(rb"<\?EndNote\s+HMAC=\"[0-9A-Fa-f]+\"\s*\?>", raw):
        findings.append(_finding("30", "ERROR", "ไม่พบบรรทัด <?EndNote HMAC=\"...\"?> ท้ายไฟล์"))

    text = raw.decode(ENCODING, "replace")
    if raw[:200].lower().find(b"utf-8") != -1:
        findings.append(_finding("30", "ERROR", "ไฟล์ถูกบันทึกเป็น UTF-8 — ต้องเป็น windows-874"))

    # Reccount ของแต่ละ section
    for section in ("IPDx", "IPOp", "BillItems"):
        rows = _rows(text, section)
        m = _RECCOUNT_RE[section].search(text)
        if m and int(m.group(1)) != len(rows):
            findings.append(_finding(
                "30", "ERROR",
                f"{section}: Reccount ระบุ {m.group(1)} แต่มีจริง {len(rows)} แถว", where=section))

    bill = _rows(text, "BillItems")
    payer = payer_group(text)

    # เลขอนุมัตินอนโรงพยาบาล (ClaimAuth)
    findings.extend(_auth_findings(raw))

    # IPDx ต้องมีโรคหลักและเลขใบประกอบวิชาชีพ
    dx = _rows(text, "IPDx")
    pdx = [d for d in dx if len(d) > 1 and d[1].strip() == "1"]
    if not pdx:
        findings.append(_finding("30", "ERROR", "IPDx: ไม่มีแถวที่เป็นโรคหลัก (DxType = 1)", where="IPDx"))
    else:
        for d in pdx:
            if len(d) > 5 and not re.fullmatch(r"[ก-ฮวว]?\d{4,6}|.\d{4,6}", d[5].strip()):
                findings.append(_finding(
                    "30", "WARNING",
                    f"IPDx แถวโรคหลัก: เลขใบประกอบวิชาชีพผิดรูปแบบ ('{d[5].strip()}')", where="IPDx"))

    # BillItems รายแถว
    rows_out: List[dict] = []
    for f in bill:
        seq = f[F_SEQ].strip() if f else "?"
        where = f"BillItems แถว {seq}"
        if len(f) != BILLITEM_FIELDS:
            findings.append(_finding("30", "ERROR", f"มี {len(f)} ฟิลด์ (ต้องเป็น {BILLITEM_FIELDS})", where=where))
            continue

        cat = f[F_CLAIMCAT].strip().upper()
        billgrcs = f[F_BILLGRCS].strip()
        qty, up = _dec(f[F_QTY]), _dec(f[F_UNITPRICE])
        amt, disc = _dec(f[F_CHARGEAMT]), _dec(f[F_DISCOUNT])
        claim_up, claim_amt = _dec(f[F_CLAIMUP]), _dec(f[F_CLAIMAMT])
        suggest = ""
        suggest_up = ""
        kind = room_kind(f)
        room_rule = room_expectation(kind, payer)

        if cat not in VALID_CLAIMCAT:
            findings.append(_finding("30", "ERROR", f"ClaimCat = '{cat}' (ต้องเป็น T, D หรือ X)", where=where))

        if None not in (qty, up, amt) and abs(qty * up - amt) > Decimal("0.01"):
            findings.append(_finding(
                "30", "WARNING",
                f"ยอดรวมไม่เท่าจำนวน x ราคาต่อหน่วย ({qty} x {up} = {qty * up} แต่ระบุ {amt})", where=where))

        if cat == "D" and claim_up is not None and claim_up != 0 and not room_rule:
            findings.append(_finding(
                "35", "ERROR", f"แถวเบิกรวมใน DRG (D) แต่มีราคาเบิกต่อหน่วย {f[F_CLAIMUP]} (ต้องเป็น 0.00)",
                where=where, suggest="ตั้ง ClaimUP/ClaimAmt เป็น 0"))
            suggest = "D"

        # ค่าห้อง: ClaimCat / ราคาเบิกตามกลุ่มสิทธิ (เกณฑ์ ศกพ.) — ใช้แทนกฏทั่วไปของหมวด 01
        if room_rule:
            want_cat, want_up, want_unit = room_rule
            label = ROOM_KINDS[kind]["label"]
            who = PAYER_LABEL[payer]
            if want_cat == "T":
                rule_txt = (f"{label} {who} เบิกได้คืนละ {want_up:,.0f} บาท นอก DRG (ClaimCat T) "
                            f"— ศกพ.คิด {ROOM_KINDS[kind]['hosp_price']:,.0f} ส่วนต่างเป็นชำระส่วนเกิน")
            else:
                rule_txt = f"{label} {who} เบิกได้คืนละ {SSO_RAMA_ROOM_UP:,.0f} บาท รวมใน DRG (ClaimCat D, ClaimUP 0)"
            wrong_cat = cat != want_cat
            wrong_up = claim_up is None or claim_up != want_up
            if wrong_cat or wrong_up:
                now = f"ตอนนี้ {cat or '-'} / ราคาเบิก {f[F_CLAIMUP].strip() or '-'}"
                findings.append(_finding(
                    "35" if want_cat == "D" else "36", "ERROR", f"ค่าห้อง: {rule_txt} — {now}",
                    where=where,
                    suggest=f"เปลี่ยนเป็น {want_cat}" + (f" ราคาเบิก {want_up:,.0f}/คืน" if want_cat == "T" else "")))
                suggest = want_cat
                suggest_up = _fmt(want_up) if want_cat == "T" else ""
            if want_unit is not None and up is not None and up != want_unit:
                findings.append(_finding(
                    "ค่าห้อง", "WARNING",
                    f"ค่าห้อง: {rule_txt} — ราคาต่อหน่วยในไฟล์ {f[F_UNITPRICE].strip()} (ควรเป็น {want_unit:,.0f} "
                    "ส่วนที่เกินแยกเป็นรายการชำระส่วนเกิน) ตรวจใน HOSxP แล้วดึงไฟล์ใหม่",
                    where=where))
            if want_cat == "T" and up is not None and up > want_up and not wrong_up:
                findings.append(_finding(
                    "ค่าห้อง", "WARNING",
                    f"ค่าห้อง: ราคาต่อหน่วยในไฟล์ {f[F_UNITPRICE].strip()} เกินอัตราเบิก {want_up:,.0f} — "
                    "ระบบนับเบิกแค่ราคาเบิก ส่วนที่เกินควรแยกเป็นรายการชำระส่วนเกินใน HOSxP",
                    where=where))

        if cat == "T":
            if None not in (qty, claim_up, claim_amt) and abs(qty * claim_up - claim_amt) > Decimal("0.01"):
                findings.append(_finding(
                    "36", "ERROR",
                    f"ยอดขอเบิกไม่เท่าจำนวน x ราคาเบิก ({qty} x {claim_up} = {qty * claim_up} แต่ระบุ {claim_amt})",
                    where=where))
            # T ได้เฉพาะหมวด 01 ห้อง/อาหาร และ 02 อวัยวะเทียม/อุปกรณ์ — หมวดอื่นถูกนับเข้า XDRGClaim
            # ทั้งที่ควรรวมใน DRG (ตรวจทุกแถว ไม่ว่าจะมีราคาเบิกหรือไม่ เช่น Hypo-hyperthermia T @200)
            if billgrcs not in BILLGRCS_T and not room_rule:
                suggest = "X" if NOT_CLAIMABLE_RE.search(f[F_DESC]) else "D"
                has_up = (claim_up or Decimal(0)) != 0
                findings.append(_finding(
                    "36", "WARNING",
                    f"เบิกแยกนอก DRG (T{f' ราคาเบิก {f[F_CLAIMUP].strip()}' if has_up else ' แต่ไม่มีราคาเบิก'}) "
                    f"แต่อยู่หมวด {billgrcs} — นอก DRG ได้เฉพาะหมวด 01 ห้อง/อาหาร และ 02 อวัยวะเทียม/อุปกรณ์"
                    + (" · ชื่อรายการระบุว่าเบิกไม่ได้/ไม่ตรงข้อบ่งชี้" if suggest == "X" else ""),
                    where=where, suggest=f"ควรเป็น {suggest}"))

        # รายการที่ชื่อระบุว่าเบิกไม่ได้ / ไม่ตรงข้อบ่งชี้ แต่ยังนับเข้ายอด (D) — ควรเป็น X (ไม่ขอเบิก)
        if cat == "D" and NOT_CLAIMABLE_RE.search(f[F_DESC]) and not is_excess_row(f):
            suggest = "X"
            findings.append(_finding(
                "ไม่ขอเบิก", "WARNING",
                f"ชื่อรายการระบุว่าเบิกไม่ได้/ไม่ตรงข้อบ่งชี้ ({f[F_DESC].strip()[:60]}) แต่เป็น D (นับเข้า DRGCharge)",
                where=where, suggest="ควรเป็น X"))

        # ปกส.รามา: ค่าห้องเบิกรวมใน DRG (D) ได้ตามเกณฑ์ — ไม่ใช้กฏทั่วไป "หมวด 01 ควรเป็น T"
        if cat == "D" and billgrcs in BILLGRCS_T and not room_rule \
                and not (payer == "sso_rama" and billgrcs == "01"):
            suggest = "T"
            findings.append(_finding(
                "35", "WARNING",
                f"อยู่หมวด {billgrcs} (ห้อง/อวัยวะเทียม) ที่ปกติเบิกแยกนอก DRG แต่ระบุเป็น D",
                where=where, suggest="ควรเป็น T"))

        for idx, name in ((F_DESC, "ชื่อรายการ"), (F_LCCODE, "รหัสรายการ")):
            if _BAD_CHARS & set(f[idx]):
                findings.append(_finding("30", "ERROR", f"{name} มีอักขระต้องห้าม (< > \" ' &)", where=where))

        excess = is_excess_row(f)
        # ระเบียบ กบก. IPD (เหมาจ่าย DRG): เก็บส่วนเกินได้เฉพาะค่าห้อง/อาหาร (01) และอวัยวะเทียม/อุปกรณ์ (02)
        excess_allowed = excess and billgrcs in BILLGRCS_T
        if excess:
            main = find_main_row(bill, f)
            main_note = f" (รายการหลักคือแถว {main[F_SEQ].strip()})" if main else ""
            if excess_allowed:
                findings.append(_finding(
                    "ส่วนเกิน", "WARNING",
                    f"รายการชำระส่วนเกินหมวด {billgrcs} ({f[F_DESC].strip()} {f[F_CHARGEAMT].strip()} บาท) — "
                    "หมวดห้อง/อวัยวะเทียมที่ระเบียบให้เก็บส่วนเกินได้ ตรวจก่อนว่าควรอยู่ในไฟล์เบิกหรือไม่",
                    where=where, suggest="ตรวจก่อนลบ" + main_note))
            else:
                findings.append(_finding(
                    "ส่วนเกิน", "ERROR",
                    f"รายการชำระส่วนเกิน ({f[F_DESC].strip()} {f[F_CHARGEAMT].strip()} บาท) — IPD เหมาจ่าย DRG "
                    "เก็บส่วนเกินไม่ได้ (ติด C: ไม่พบ TMLT ใน Lab Catalog และยอดถูกนับเข้า DRGCharge)",
                    where=where, suggest="ลบแถวนี้" + main_note))

        rows_out.append({
            "seq": seq,
            "is_excess": excess,
            "excess_allowed": excess_allowed,
            "main_seq": (find_main_row(bill, f) or [""])[0].strip() if excess else "",
            "servdate": f[F_SERVDATE].strip(),
            "billgrcs": billgrcs,
            "lccode": f[F_LCCODE].strip(),
            "desc": f[F_DESC].strip(),
            "qty": f[F_QTY].strip(),
            "unit_price": f[F_UNITPRICE].strip(),
            "charge_amt": f[F_CHARGEAMT].strip(),
            "discount": f[F_DISCOUNT].strip(),
            "claim_cat": cat,
            "claim_up": f[F_CLAIMUP].strip(),
            "claim_amt": f[F_CLAIMAMT].strip(),
            "suggest_cat": suggest,
            "suggest_up": suggest_up,
            "room_kind": kind,
        })

    # ยอดรวมท้ายไฟล์
    totals = compute_totals(bill)
    file_totals = {}
    for tag, key in (("DRGCharge", "drg_charge"), ("XDRGClaim", "xdrg_claim")):
        m = re.search(rf"<{tag}>([^<]*)</{tag}>", text)
        file_totals[key] = (m.group(1).strip() if m else "")
        if m:
            got = _dec(m.group(1))
            if got is not None and got != totals[key]:
                findings.append(_finding(
                    "35" if tag == "DRGCharge" else "36", "ERROR",
                    f"{tag} ในไฟล์ {m.group(1).strip()} แต่คำนวณจากรายการได้ {_fmt(totals[key])}",
                    where=tag, suggest="ให้ระบบคำนวณใหม่"))

    sig_ok = verify_hmac(raw)
    if sig_ok is False:
        findings.append(_finding(
            "22", "ERROR", "ค่า HMAC ท้ายไฟล์ไม่ตรงกับเนื้อไฟล์ (ไฟล์ถูกแก้โดยไม่ได้คำนวณใหม่)",
            where="EndNote", suggest="ให้ระบบคำนวณใหม่"))

    return {
        "findings": findings,
        "rows": rows_out,
        "totals": {
            "drg_charge_file": file_totals.get("drg_charge", ""),
            "xdrg_claim_file": file_totals.get("xdrg_claim", ""),
            "drg_charge_calc": _fmt(totals["drg_charge"]),
            "xdrg_claim_calc": _fmt(totals["xdrg_claim"]),
        },
        "signature_ok": sig_ok,
        "auth": read_auth(raw),
        "payer": payer,
        "payer_label": PAYER_LABEL.get(payer, ""),
        "error_count": sum(1 for f in findings if f["severity"] == "ERROR"),
        "warning_count": sum(1 for f in findings if f["severity"] == "WARNING"),
        "can_fix": True,
    }


def set_claim_cat(raw: bytes, changes: List[dict]) -> tuple:
    """
    เปลี่ยน ClaimCat ของแถวที่ระบุ — changes: [{seq, claim_cat, claim_up?}]
      D : ตั้ง ClaimUP = 0.00 และ ClaimAmt = 0.0000
      T : ต้องระบุ claim_up (ราคาตามบัญชีอัตราของกรมบัญชีกลาง) แล้วคิด ClaimAmt = QTY x ClaimUP
      X : บริจาค/ทุนวิจัย — ตั้งยอดเบิกเป็น 0 เช่นเดียวกับ D
    คืน (ไบต์ใหม่, รายการที่แก้จริง)
    """
    wanted = {}
    for c in changes:
        seq = str(c.get("seq", "")).strip()
        cat = str(c.get("claim_cat", "")).strip().upper()
        if not seq:
            continue
        if cat not in VALID_CLAIMCAT:
            raise ValueError(f"แถว {seq}: ClaimCat ต้องเป็น T, D หรือ X (ได้ '{cat}')")
        up = c.get("claim_up")
        if cat == "T":
            if up is None or str(up).strip() == "":
                raise ValueError(
                    f"แถว {seq}: เปลี่ยนเป็น T ต้องระบุราคาเบิกต่อหน่วยตามบัญชีอัตราของกรมบัญชีกลาง "
                    "— ระบบไม่คิดราคาให้เองจากยอดที่เรียกเก็บ"
                )
            if _dec(str(up)) is None:
                raise ValueError(f"แถว {seq}: ราคาเบิกต่อหน่วยไม่ใช่ตัวเลข ('{up}')")
        wanted[seq] = (cat, up)

    if not wanted:
        raise ValueError("ยังไม่ได้เลือกแถวที่จะเปลี่ยน ClaimCat")

    text = raw.decode(ENCODING)
    lines = text.split("\r\n")
    applied: List[dict] = []
    for i, line in enumerate(lines):
        f = line.split("|")
        if len(f) != BILLITEM_FIELDS:
            continue
        seq = f[F_SEQ].strip()
        if seq not in wanted:
            continue
        cat, up = wanted[seq]
        before = {"claim_cat": f[F_CLAIMCAT], "claim_up": f[F_CLAIMUP], "claim_amt": f[F_CLAIMAMT]}
        f[F_CLAIMCAT] = cat
        if cat in ("D", "X"):
            f[F_CLAIMUP], f[F_CLAIMAMT] = "0.00", "0.0000"
        else:
            up_dec = _dec(str(up))
            qty = _dec(f[F_QTY]) or Decimal(0)
            f[F_CLAIMUP], f[F_CLAIMAMT] = _fmt(up_dec), _fmt(up_dec * qty)
        lines[i] = "|".join(f)
        applied.append({
            "seq": seq, "desc": f[F_DESC].strip(),
            "before": before,
            "after": {"claim_cat": f[F_CLAIMCAT], "claim_up": f[F_CLAIMUP], "claim_amt": f[F_CLAIMAMT]},
        })

    missing = set(wanted) - {a["seq"] for a in applied}
    if missing:
        raise ValueError(f"ไม่พบแถวที่ {sorted(missing)} ใน BillItems")
    return "\r\n".join(lines).encode(ENCODING), applied


def finalize(raw: bytes, effective_time: str = "") -> bytes:
    """คำนวณ DRGCharge / XDRGClaim ใหม่ (+ effectiveTime ถ้าระบุ) แล้วเซ็น HMAC ใหม่"""
    text = raw.decode(ENCODING)
    totals = compute_totals(_rows(text, "BillItems"))
    text = re.sub(r"<DRGCharge>[^<]*</DRGCharge>",
                  f"<DRGCharge>{_fmt(totals['drg_charge'])}</DRGCharge>", text, count=1)
    text = re.sub(r"<XDRGClaim>[^<]*</XDRGClaim>",
                  f"<XDRGClaim>{_fmt(totals['xdrg_claim'])}</XDRGClaim>", text, count=1)
    if effective_time:
        text = re.sub(r"<effectiveTime>[^<]*</effectiveTime>",
                      f"<effectiveTime>{effective_time}</effectiveTime>", text, count=1)

    new_raw = text.encode(ENCODING)
    k = new_raw.index(b"<?EndNote")
    head, tail = new_raw[:k], new_raw[k:]
    sig = compute_cipn_md5(head).encode("ascii")
    # คงรูปแบบบรรทัดเดิมของไฟล์ (บางฉบับเว้นวรรคก่อน ?>)
    endnote = re.sub(rb'"[0-9A-Fa-f]+"', b'"' + sig + b'"', tail, count=1)
    return head + endnote


def output_filename(raw: bytes, submit_dt: str) -> str:
    """ชื่อไฟล์ตามสเปก: HCode-CIPN-AN-YYYYMMDDHHMMSS.xml"""
    text = raw.decode(ENCODING, "replace")
    hcode = (re.search(r"<authorID>([^<]*)</authorID>", text) or [None, "00000"])[1]
    doc = (re.search(r"<DocSysID[^>]*>([^<]*)</DocSysID>", text) or [None, "CIPN"])[1]
    ipadt = _rows(text, "IPADT") or [[""]]
    an = ipadt[0][0].strip() if ipadt and ipadt[0] else ""
    return f"{hcode}-{doc}-{an}-{submit_dt}.xml"
