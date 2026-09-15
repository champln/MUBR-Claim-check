"""
CSOP / CHI XML claim-file editor (byte-faithful).

ใช้สำหรับ "แก้ไฟล์ส่งเบิกกรมบัญชีกลาง (สกส.) แล้วส่งได้จริง" — โดยเฉพาะเคส
เบิกเครื่อง CPAP / ตรวจการนอนหลับ (sleep test / Polysomnogram).

หลักการสำคัญ
------------
1.  ไฟล์ CSOP (BILLTRAN / BILLDISP / OPServices) เป็น CHI XML encoding windows-874
    ปิดท้ายด้วยบรรทัด  <?EndNote Checksum="...."?>
2.  Checksum = MD5 ของ "ไบต์ทั้งหมดตั้งแต่ต้นไฟล์ จนถึงก่อน <?EndNote"
    (รวม CRLF ปิดท้าย </ClaimRec> ด้วย) แล้วทำเป็น hex ตัวพิมพ์ใหญ่
    -- พิสูจน์ตรงกับไฟล์จริงทั้งของเดิมและของที่ IT แก้แล้ว (ดู test_csop_editor.py)
3.  การแก้ไขทำที่ระดับ "บรรทัดดิบ" (pipe-delimited) เพื่อรักษาทุกฟิลด์/ไบต์เดิม
    ไม่ผ่านการ reconstruct จาก model (กัน field หล่นและ checksum เพี้ยน)

สูตรแก้ไขเคส CPAP (อ้างอิงหนังสือ สกส. CHI68-A01 + ไฟล์ตัวอย่าง IT แก้แล้ว)
---------------------------------------------------------------------------
- BILLTRAN  field[1]  (BillTran.AuthCode)  ""  -> "STCPAP"
- OPServices field[2] (OPServices.Class)   "EC" -> "ED"   (Endorser)
- OPDx      field[0]                       "EC" -> "ED"
- OPServices field[20] (OPServices.SvPID)  ""  -> <รหัสอนุมัติ เช่น B4GFQJ>
- ทุกไฟล์ที่ถูกแก้ -> คำนวณ Checksum ใหม่
"""
from __future__ import annotations

import hashlib
import re
from decimal import Decimal, InvalidOperation
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional

ENCODING = "cp874"  # = windows-874
ENDNOTE_MARKER = b"<?EndNote"

# field index ในแต่ละ section (0-based) ที่เกี่ยวกับการแก้ CPAP
BILLTRAN_AUTHCODE_IDX = 1
OPSERVICES_CLASS_IDX = 2
OPSERVICES_VISIT_IDX = 0
OPSERVICES_DOCTOR_IDX = 11   # เลขใบประกอบวิชาชีพแพทย์ (ว.....)
OPSERVICES_SVPID_IDX = 20
OPDX_CLASS_IDX = 0
OPDX_REF_IDX = 1

# เลข ว แพทย์ที่ต้องใช้ แยกตามประเภทเคส
#   PSG  (ตรวจการนอนหลับ) -> ว29312  นพ.ทินนกร ยาดี
#   CPAP (เบิกเครื่อง)     -> ว47988  นพ.วีระชัย ศรีมหาโกศล
DOCTOR_BY_CLAIM = {
    "CPAP": "ว47988",
    "PSG": "ว29312",
}
DOCTOR_NAME_BY_CLAIM = {
    "CPAP": "นพ.วีระชัย ศรีมหาโกศล",
    "PSG": "นพ.ทินนกร ยาดี",
}
# คงไว้เพื่อความเข้ากันได้ (ค่า fallback เดิม)
DEFAULT_DOCTOR_LICENSE = DOCTOR_BY_CLAIM["PSG"]

# ─── ประเภทเคสที่รองรับ ───────────────────────────────────────────────────────
# CPAP = เบิกเครื่อง CPAP   -> แก้ BILLTRAN(STCPAP) + OPServices(ED/SvPID) + OPDx(ED)
# PSG  = ตรวจการนอนหลับ      -> แก้เฉพาะ OPServices(ED/SvPID) + OPDx(ED)  (ไม่ยุ่ง BILLTRAN)
CPAP_NAME_RE = re.compile(r"cpap", re.IGNORECASE)
PSG_NAME_RE = re.compile(r"sleep\s*test|polysomnogram|ตรวจการนอนหลับ", re.IGNORECASE)

CLAIM_CPAP = "CPAP"
CLAIM_PSG = "PSG"


def classify_item_name(name: str) -> Optional[str]:
    """แยกประเภทเคสจากชื่อรายการใน BillItems (CPAP มาก่อน PSG)"""
    if CPAP_NAME_RE.search(name or ""):
        return CLAIM_CPAP
    if PSG_NAME_RE.search(name or ""):
        return CLAIM_PSG
    return None


# ─── Checksum ───────────────────────────────────────────────────────────────

def compute_checksum(head: bytes) -> str:
    """MD5 (uppercase hex) ของไบต์ก่อน <?EndNote ตามสเปก สกส./CHI"""
    return hashlib.md5(head).hexdigest().upper()


def split_endnote(raw: bytes) -> tuple[bytes, Optional[bytes]]:
    """แยกไฟล์เป็น (head, endnote)  head = ทุกไบต์ก่อน <?EndNote"""
    idx = raw.find(ENDNOTE_MARKER)
    if idx < 0:
        return raw, None
    return raw[:idx], raw[idx:]


def verify_checksum(raw: bytes) -> Optional[bool]:
    """ตรวจว่า checksum ในไฟล์ตรงกับเนื้อหาไหม (None = ไม่มี EndNote)"""
    head, endnote = split_endnote(raw)
    if endnote is None:
        return None
    # รองรับทั้ง Checksum / CheckSum (บางเครื่องมือเขียน S ใหญ่)
    m = re.search(rb'Check[Ss]um="([0-9A-Fa-f]+)"', endnote)
    if not m:
        return None
    stored = m.group(1).decode("ascii").upper()
    return stored == compute_checksum(head)


# ─── Faithful file model ────────────────────────────────────────────────────

@dataclass
class CsopFile:
    """
    โมเดลไฟล์ CSOP แบบรักษาไบต์/บรรทัดเดิม
    head_text : ข้อความ (decode cp874) ของส่วนก่อน <?EndNote
    eol       : ตัวขึ้นบรรทัด ("\\r\\n" หรือ "\\n")
    trailing  : ไบต์ระหว่างท้าย head กับ <?EndNote ที่ไม่ได้ลงท้ายด้วย eol (ปกติว่าง)
    """
    head_text: str
    eol: str
    pay_plan: str = ""
    system: str = ""

    @classmethod
    def parse(cls, raw: bytes) -> "CsopFile":
        head, _ = split_endnote(raw)
        # ตรวจ EOL จาก head
        eol = "\r\n" if b"\r\n" in head else "\n"
        head_text = head.decode(ENCODING)
        # guard: round-trip ต้องตรงไบต์เดิม (cp874 เป็น codec 1-ไบต์ -> ปลอดภัย)
        if head_text.encode(ENCODING) != head:
            raise ValueError("cp874 round-trip mismatch — ไฟล์มีไบต์นอกชุด cp874")
        obj = cls(head_text=head_text, eol=eol)
        obj.pay_plan = obj._attr("PayPlan")
        obj.system = obj._attr("System")
        return obj

    def _attr(self, name: str) -> str:
        m = re.search(rf'{name}="([^"]*)"', self.head_text)
        return m.group(1) if m else ""

    # ── section editing ────────────────────────────────────────────────────
    def edit_section(self, tag: str, fn: Callable[[List[str]], Optional[List[str]]]) -> int:
        """
        เรียก fn กับ "ฟิลด์ที่ split แล้ว" ของแต่ละบรรทัดข้อมูลใน <tag>...</tag>
        fn คืน list ใหม่เพื่อแทนที่ หรือ None เพื่อไม่แก้
        คืนจำนวนบรรทัดที่ถูกแก้จริง
        """
        lines = self.head_text.split(self.eol)
        open_tag, close_tag = f"<{tag}>", f"</{tag}>"
        inside = False
        changed = 0
        for i, line in enumerate(lines):
            stripped = line.strip()
            if stripped == open_tag:
                inside = True
                continue
            if stripped == close_tag:
                inside = False
                continue
            if inside and stripped:
                cols = line.split("|")
                new_cols = fn(cols)
                if new_cols is not None and new_cols != cols:
                    lines[i] = "|".join(new_cols)
                    changed += 1
        self.head_text = self.eol.join(lines)
        return changed

    def section_rows(self, tag: str) -> List[List[str]]:
        """อ่านบรรทัดข้อมูลใน <tag> เป็น list ของ field-list (read-only)"""
        lines = self.head_text.split(self.eol)
        open_tag, close_tag = f"<{tag}>", f"</{tag}>"
        inside = False
        rows: List[List[str]] = []
        for line in lines:
            stripped = line.strip()
            if stripped == open_tag:
                inside = True
                continue
            if stripped == close_tag:
                inside = False
                continue
            if inside and stripped:
                rows.append(line.split("|"))
        return rows

    # ── serialize ────────────────────────────────────────────────────────────
    def to_bytes(self) -> bytes:
        head = self.head_text.encode(ENCODING)
        checksum = compute_checksum(head)
        endnote = f'<?EndNote Checksum="{checksum}"?>'.encode(ENCODING)
        return head + endnote


# ─── CPAP fix ───────────────────────────────────────────────────────────────

def _set_field(cols: List[str], idx: int, value: str) -> List[str]:
    while len(cols) <= idx:
        cols.append("")
    cols[idx] = value
    return cols


def detect_claim_visits(billtran: CsopFile) -> Dict[str, str]:
    """
    หา visit ที่ต้องแก้พร้อมประเภท -> {visit_no: "CPAP"|"PSG"}
    (อิงจากชื่อรายการใน BillItems; CPAP มาก่อน PSG)
    """
    visits: Dict[str, str] = {}
    for row in billtran.section_rows("BillItems"):
        if len(row) >= 6:
            vno = row[0].strip()
            if not vno:
                continue
            ctype = classify_item_name(row[5] or "")
            if ctype == CLAIM_CPAP:
                visits[vno] = CLAIM_CPAP  # CPAP ทับ PSG เสมอ
            elif ctype == CLAIM_PSG and vno not in visits:
                visits[vno] = CLAIM_PSG
    return visits


def detect_cpap_visits(billtran: CsopFile) -> List[str]:
    """(คงไว้เพื่อความเข้ากันได้) คืนเฉพาะ visit CPAP"""
    return [v for v, t in detect_claim_visits(billtran).items() if t == CLAIM_CPAP]


@dataclass
class CpapFixResult:
    files: Dict[str, bytes]
    changes: List[str] = field(default_factory=list)


def apply_fix(
    files: Dict[str, bytes],
    auth_by_visit: Dict[str, str],
    target_visits: Optional[List[str]] = None,
    doctor_license: Optional[str] = None,
) -> CpapFixResult:
    """
    แก้ชุดไฟล์ CSOP ตามประเภทเคส (auto-detect ทั้ง CPAP และ PSG ในไฟล์เดียวได้)
    - CPAP : BILLTRAN.AuthCode=STCPAP + OPServices(Class=ED, Doctor=ว47988, SvPID) + OPDx(ED)
    - PSG  : เฉพาะ OPServices(Class=ED, Doctor=ว29312, SvPID) + OPDx(ED)  (ไม่แตะ BILLTRAN/BILLDISP)
    - auth_by_visit  : {visit_no: รหัสอนุมัติ (SvPID)}
    - target_visits  : จำกัด visit ที่จะแก้; None = แก้ทุก visit ที่ตรวจพบ
    - doctor_license : ถ้าระบุ จะบังคับใช้เลข ว นี้กับทุก visit; ถ้า None จะใช้ตามชนิด (DOCTOR_BY_CLAIM)
    """
    out: Dict[str, bytes] = dict(files)
    changes: List[str] = []

    billtran_name = _find(files, "BILLTRAN")
    opsvc_name = _find(files, "OPSERVICES")

    # ตรวจประเภทของแต่ละ visit จาก BILLTRAN
    visit_types: Dict[str, str] = {}
    if billtran_name:
        visit_types = detect_claim_visits(CsopFile.parse(files[billtran_name]))
    if target_visits is not None:
        tset = set(target_visits)
        visit_types = {v: t for v, t in visit_types.items() if v in tset}

    cpap_visits = {v for v, t in visit_types.items() if t == CLAIM_CPAP}
    all_visits = set(visit_types)

    # 1) BILLTRAN — STCPAP เฉพาะ visit ประเภท CPAP
    if billtran_name and cpap_visits:
        bt = CsopFile.parse(files[billtran_name])

        def fix_billtran(cols: List[str]) -> Optional[List[str]]:
            vno = cols[4].strip() if len(cols) > 4 else ""
            if vno in cpap_visits:
                return _set_field(list(cols), BILLTRAN_AUTHCODE_IDX, "STCPAP")
            return None

        n = bt.edit_section("BILLTRAN", fix_billtran)
        out[billtran_name] = bt.to_bytes()
        if n:
            changes.append(f"{billtran_name}: AuthCode=STCPAP ({n} visit CPAP)")

    # 2) OPServices — Class EC->ED + SvPID; OPDx Class EC->ED (ทุก visit ที่แก้ ทั้ง CPAP/PSG)
    if opsvc_name and all_visits:
        op = CsopFile.parse(files[opsvc_name])

        refs_for_visit = set()
        for row in op.section_rows("OPServices"):
            if len(row) > OPSERVICES_VISIT_IDX and row[OPSERVICES_VISIT_IDX].strip() in all_visits:
                if len(row) > 1:
                    refs_for_visit.add(row[1].strip())

        def fix_opservices(cols: List[str]) -> Optional[List[str]]:
            vno = cols[OPSERVICES_VISIT_IDX].strip() if cols else ""
            if vno not in all_visits:
                return None
            new = list(cols)
            _set_field(new, OPSERVICES_CLASS_IDX, "ED")
            # เลข ว แพทย์: บังคับตาม doctor_license ถ้าระบุ ไม่งั้นตามชนิดของ visit
            doc = doctor_license or DOCTOR_BY_CLAIM.get(visit_types.get(vno, ""), "")
            if doc:
                _set_field(new, OPSERVICES_DOCTOR_IDX, doc)
            auth = auth_by_visit.get(vno, "")
            if auth:
                _set_field(new, OPSERVICES_SVPID_IDX, auth)
            return new

        n1 = op.edit_section("OPServices", fix_opservices)

        def fix_opdx(cols: List[str]) -> Optional[List[str]]:
            ref = cols[OPDX_REF_IDX].strip() if len(cols) > OPDX_REF_IDX else ""
            if ref in refs_for_visit:
                return _set_field(list(cols), OPDX_CLASS_IDX, "ED")
            return None

        n2 = op.edit_section("OPDx", fix_opdx)
        out[opsvc_name] = op.to_bytes()
        if n1 or n2:
            doc = f", แพทย์={doctor_license}" if doctor_license else ""
            changes.append(f"{opsvc_name}: Class=ED ({n1} svc / {n2} dx), SvPID set{doc}")

    return CpapFixResult(files=out, changes=changes)


# คงชื่อเดิมเพื่อความเข้ากันได้
apply_cpap_fix = apply_fix


# ─── COVID-19 fix ─────────────────────────────────────────────────────────────
# เคส: ต้องระบุ AuthCode = "COV-19" ใน BILLTRAN สำหรับ visit ที่เป็นการรักษาโควิด
# แก้เฉพาะ BILLTRAN field[1] (AuthCode) โดยจับคู่จาก InvNo (field[4]) หรือ HN (field[6])
BILLTRAN_INVNO_IDX = 4
BILLTRAN_HN_IDX = 6
BILLTRAN_NAME_IDX = 13
COVID19_AUTHCODE = "COV-19"


@dataclass
class Covid19Result:
    files: Dict[str, bytes]
    changed: int = 0
    changes: List[str] = field(default_factory=list)


def _norm(s: str) -> str:
    return (s or "").strip()


def preview_covid19(
    files: Dict[str, bytes],
    invno_set: Optional[set] = None,
    hn_set: Optional[set] = None,
    apply_all: bool = False,
) -> dict:
    """
    ดูรายการ BILLTRAN ทั้งหมด + ระบุว่าแถวไหนจะถูกเติม COV-19
    invno_set / hn_set : เซ็ตเป้าหมาย (ค่าที่ strip แล้ว) — ถ้าทั้งคู่ None/ว่าง จะไม่มีแถวไหน match
    apply_all          : True = เติมทุก record ในไฟล์ (ไม่สนเป้าหมาย)
    """
    invno_set = {_norm(x) for x in (invno_set or set()) if _norm(x)}
    hn_set = {_norm(x) for x in (hn_set or set()) if _norm(x)}

    billtran_name = _find(files, "BILLTRAN")
    if not billtran_name:
        raise ValueError("ไม่พบไฟล์ BILLTRAN ในรายการที่อัปโหลด")

    bt = CsopFile.parse(files[billtran_name])
    rows_out: List[dict] = []
    match_count = 0
    already = 0
    for row in bt.section_rows("BILLTRAN"):
        if len(row) <= BILLTRAN_INVNO_IDX:
            continue
        invno = _norm(row[BILLTRAN_INVNO_IDX])
        hn = _norm(row[BILLTRAN_HN_IDX]) if len(row) > BILLTRAN_HN_IDX else ""
        cur_auth = _norm(row[BILLTRAN_AUTHCODE_IDX]) if len(row) > BILLTRAN_AUTHCODE_IDX else ""
        name = _norm(row[BILLTRAN_NAME_IDX]) if len(row) > BILLTRAN_NAME_IDX else ""
        is_match = apply_all or (invno in invno_set) or (hn and hn in hn_set)
        if is_match:
            match_count += 1
            if cur_auth == COVID19_AUTHCODE:
                already += 1
        rows_out.append({
            "invno": invno,
            "hn": hn,
            "patient_name": name,
            "current_authcode": cur_auth,
            "will_change": is_match and cur_auth != COVID19_AUTHCODE,
            "matched": is_match,
        })

    return {
        "billtran_file": billtran_name,
        "checksum_valid": verify_checksum(files[billtran_name]),
        "total_rows": len(rows_out),
        "match_count": match_count,
        "already_count": already,      # match แต่เป็น COV-19 อยู่แล้ว
        "will_change_count": match_count - already,
        "rows": rows_out,
    }


def apply_covid19(
    files: Dict[str, bytes],
    invno_set: Optional[set] = None,
    hn_set: Optional[set] = None,
    apply_all: bool = False,
) -> Covid19Result:
    """
    เติม AuthCode='COV-19' ใน BILLTRAN สำหรับแถวที่ InvNo/HN ตรงเป้าหมาย
    (หรือทุก record ถ้า apply_all=True) แล้วเซ็น Checksum ใหม่
    คืนเฉพาะไฟล์ BILLTRAN ที่แก้ (ไฟล์อื่นไม่แตะ)
    """
    invno_set = {_norm(x) for x in (invno_set or set()) if _norm(x)}
    hn_set = {_norm(x) for x in (hn_set or set()) if _norm(x)}
    if not apply_all and not invno_set and not hn_set:
        raise ValueError("ต้องระบุ InvNo หรือ HN อย่างน้อย 1 รายการ (หรือเลือกเติมทุก VN)")

    out: Dict[str, bytes] = dict(files)
    billtran_name = _find(files, "BILLTRAN")
    if not billtran_name:
        raise ValueError("ไม่พบไฟล์ BILLTRAN ในรายการที่อัปโหลด")

    bt = CsopFile.parse(files[billtran_name])

    def fix(cols: List[str]) -> Optional[List[str]]:
        if len(cols) <= BILLTRAN_INVNO_IDX:
            return None
        invno = _norm(cols[BILLTRAN_INVNO_IDX])
        hn = _norm(cols[BILLTRAN_HN_IDX]) if len(cols) > BILLTRAN_HN_IDX else ""
        if apply_all or (invno in invno_set) or (hn and hn in hn_set):
            return _set_field(list(cols), BILLTRAN_AUTHCODE_IDX, COVID19_AUTHCODE)
        return None

    n = bt.edit_section("BILLTRAN", fix)
    out[billtran_name] = bt.to_bytes()

    changes: List[str] = []
    if n:
        changes.append(f"{billtran_name}: AuthCode=COV-19 ({n} รายการ)")
    return Covid19Result(files=out, changed=n, changes=changes)


# ─── ประกันสังคมรามา SH 50 ────────────────────────────────────────────────────
# เติมข้อมูลใน BILLTRAN สำหรับสิทธิประกันสังคมที่มี รพ.หลักเป็นรามาธิบดี:
#   1) HMain (field[14]) ว่าง -> รหัส รพ.หลัก (default "13781" = รามาธิบดี)
#   2) แถวที่ผู้ป่วยจ่ายค่าธรรมเนียม (Amount − ClaimAmt == 50) และยังไม่มีผู้ร่วมจ่าย
#      -> OtherPayplan (field[17]) = "SH", OtherPay (field[18]) = "50.00"
#   * พิสูจน์ byte-exact กับไฟล์จริง 40922_SSOPBIL_0227 (before -> แก้เสร็จแล้ว)
#   * หมายเหตุ: เงื่อนไข 2 อิงส่วนต่าง 50 บาท (ไม่ใช่แค่ลงท้าย ||0.00) ตามไฟล์ตัวอย่างจริง
BILLTRAN_AMOUNT_IDX = 8
BILLTRAN_CLAIMAMT_IDX = 16
BILLTRAN_HMAIN_IDX = 14
BILLTRAN_OTHERPAYPLAN_IDX = 17
BILLTRAN_OTHERPAY_IDX = 18

RAMA_HMAIN_DEFAULT = "13781"      # รหัส รพ.รามาธิบดี
SH_PAYPLAN = "SH"                  # สถานพยาบาลยกเว้นค่ารักษาพยาบาล
SH_AMOUNT_DEFAULT = "50.00"       # ค่าธรรมเนียมที่ผู้ป่วยจ่าย


@dataclass
class RamaSh50Result:
    files: Dict[str, bytes]
    hmain_filled: int = 0
    sh_set: int = 0
    changes: List[str] = field(default_factory=list)


def _fnum(s: str) -> float:
    try:
        return float((s or "").strip())
    except (TypeError, ValueError):
        return 0.0


# BillItems (ใน BILLTRAN): [0]InvNo [1]date [2]BillMu [3]code [4]lccode [5]desc [6]qty [7]up [8]amount
BILLITEMS_BILLMU_IDX = 2
BILLITEMS_AMOUNT_IDX = 8
HOSP_FEE_BILLMU = "G"   # ค่าธรรมเนียมโรงพยาบาล = BillMu 'G'


def _fee_invnos(bt: "CsopFile", sh_str: str) -> set:
    """
    คืนเซ็ต InvNo ที่มี 'ค่าธรรมเนียมโรงพยาบาล' (BillMu='G', ยอด = ค่าธรรมเนียม)
    ใน BillItems — ใช้ตัดสินว่า visit ไหนควรตั้ง OtherPayplan=SH / OtherPay
    (ไม่อิงส่วนต่าง Amount−ClaimAmt เพราะมี Paid/หักอื่นได้)
    """
    invnos: set = set()
    for row in bt.section_rows("BillItems"):
        if len(row) <= BILLITEMS_AMOUNT_IDX:
            continue
        if _norm(row[BILLITEMS_BILLMU_IDX]) == HOSP_FEE_BILLMU and _norm(row[BILLITEMS_AMOUNT_IDX]) == sh_str:
            invnos.add(_norm(row[0]))
    return invnos


def preview_rama_sh50(
    files: Dict[str, bytes],
    hmain: str = RAMA_HMAIN_DEFAULT,
    sh_amount: str = SH_AMOUNT_DEFAULT,
    exclude_invnos: Optional[set] = None,
) -> dict:
    """ดูรายการ BILLTRAN ทั้งหมด + ระบุว่าแต่ละแถวจะถูกเติม HMain / SH อย่างไร
    exclude_invnos : Inv.no ที่ยกเว้น ไม่ตั้ง SH (เช่น visit ที่ 2+ ในวันเดียวกัน)
    """
    hmain = _norm(hmain) or RAMA_HMAIN_DEFAULT
    sh_val = _fnum(sh_amount) or 50.0
    excl = {_norm(x) for x in (exclude_invnos or set()) if _norm(x)}

    billtran_name = _find(files, "BILLTRAN")
    if not billtran_name:
        raise ValueError("ไม่พบไฟล์ BILLTRAN ในรายการที่อัปโหลด")

    bt = CsopFile.parse(files[billtran_name])
    sh_str = f"{sh_val:.2f}"
    fee_invnos = _fee_invnos(bt, sh_str)   # visit ที่มีค่าธรรมเนียมโรงพยาบาล 50 บาท
    rows_out: List[dict] = []
    hmain_cnt = sh_cnt = excl_cnt = 0
    for row in bt.section_rows("BILLTRAN"):
        if len(row) < 19:
            continue
        invno = _norm(row[BILLTRAN_INVNO_IDX])
        name = _norm(row[BILLTRAN_NAME_IDX])
        cur_hmain = _norm(row[BILLTRAN_HMAIN_IDX])
        amount = _fnum(row[BILLTRAN_AMOUNT_IDX])
        claim = _fnum(row[BILLTRAN_CLAIMAMT_IDX])
        diff = round(amount - claim, 2)
        cur_opp = _norm(row[BILLTRAN_OTHERPAYPLAN_IDX])
        cur_op = _norm(row[BILLTRAN_OTHERPAY_IDX])

        excluded = invno in excl
        will_hmain = cur_hmain == ""
        # SH เมื่อ: ยังไม่มีผู้ร่วมจ่าย + visit มีค่าธรรมเนียมโรงพยาบาล 50 บาทใน BillItems
        sh_eligible = (cur_opp == "") and (cur_op == "0.00") and (invno in fee_invnos)
        will_sh = sh_eligible and not excluded
        if will_hmain:
            hmain_cnt += 1
        if will_sh:
            sh_cnt += 1
        if excluded and sh_eligible:
            excl_cnt += 1
        rows_out.append({
            "invno": invno,
            "patient_name": name,
            "amount": amount,
            "claim_amt": claim,
            "diff": diff,
            "current_hmain": cur_hmain,
            "current_otherpayplan": cur_opp,
            "will_fill_hmain": will_hmain,
            "will_set_sh": will_sh,
            "excluded": excluded,
        })

    return {
        "billtran_file": billtran_name,
        "checksum_valid": verify_checksum(files[billtran_name]),
        "hmain_code": hmain,
        "sh_amount": f"{sh_val:.2f}",
        "total_rows": len(rows_out),
        "hmain_fill_count": hmain_cnt,
        "sh_set_count": sh_cnt,
        "excluded_count": excl_cnt,      # แถวที่เข้าเงื่อนไข SH แต่ถูกยกเว้น
        "rows": rows_out,
    }


def apply_rama_sh50(
    files: Dict[str, bytes],
    hmain: str = RAMA_HMAIN_DEFAULT,
    sh_amount: str = SH_AMOUNT_DEFAULT,
    exclude_invnos: Optional[set] = None,
) -> RamaSh50Result:
    """
    เติม HMain=รหัส รพ.หลัก และ OtherPayplan=SH / OtherPay=สำหรับแถวที่มีส่วนต่าง
    เท่ากับค่าธรรมเนียม แล้วเซ็น Checksum ใหม่ (แก้เฉพาะ BILLTRAN)
    exclude_invnos : Inv.no ที่ยกเว้นการตั้ง SH (HMain ยังเติมปกติ)
    """
    hmain = _norm(hmain) or RAMA_HMAIN_DEFAULT
    sh_val = _fnum(sh_amount) or 50.0
    sh_str = f"{sh_val:.2f}"
    excl = {_norm(x) for x in (exclude_invnos or set()) if _norm(x)}

    out: Dict[str, bytes] = dict(files)
    billtran_name = _find(files, "BILLTRAN")
    if not billtran_name:
        raise ValueError("ไม่พบไฟล์ BILLTRAN ในรายการที่อัปโหลด")

    bt = CsopFile.parse(files[billtran_name])
    fee_invnos = _fee_invnos(bt, sh_str)   # visit ที่มีค่าธรรมเนียมโรงพยาบาล 50 บาท
    counters = {"hmain": 0, "sh": 0, "excluded": 0}

    def fix(cols: List[str]) -> Optional[List[str]]:
        if len(cols) < 19:
            return None
        new = list(cols)
        changed = False
        # 1) HMain ว่าง -> รหัส รพ.หลัก (เติมทุกแถวรวมที่ถูกยกเว้น SH)
        if _norm(new[BILLTRAN_HMAIN_IDX]) == "":
            _set_field(new, BILLTRAN_HMAIN_IDX, hmain)
            counters["hmain"] += 1
            changed = True
        # 2) visit มีค่าธรรมเนียมโรงพยาบาล 50 บาท และยังไม่มีผู้ร่วมจ่าย -> OtherPayplan=SH
        #    ยกเว้น Inv.no ที่ผู้ใช้ระบุ (visit ที่ 2+ ในวันเดียวกัน ไม่เก็บค่าธรรมเนียมซ้ำ)
        invno = _norm(new[BILLTRAN_INVNO_IDX])
        if (_norm(new[BILLTRAN_OTHERPAYPLAN_IDX]) == "" and _norm(new[BILLTRAN_OTHERPAY_IDX]) == "0.00"
                and invno in fee_invnos):
            if invno in excl:
                counters["excluded"] += 1
            else:
                _set_field(new, BILLTRAN_OTHERPAYPLAN_IDX, SH_PAYPLAN)
                _set_field(new, BILLTRAN_OTHERPAY_IDX, sh_str)
                counters["sh"] += 1
                changed = True
        return new if changed else None

    bt.edit_section("BILLTRAN", fix)
    out[billtran_name] = bt.to_bytes()

    changes: List[str] = []
    if counters["hmain"]:
        changes.append(f"{billtran_name}: เติม HMain={hmain} ({counters['hmain']} แถว)")
    if counters["sh"]:
        changes.append(f"{billtran_name}: ตั้ง OtherPayplan=SH / OtherPay={sh_str} ({counters['sh']} แถว)")
    if counters["excluded"]:
        changes.append(f"{billtran_name}: ยกเว้น SH {counters['excluded']} แถว (ตามที่ระบุ)")
    return RamaSh50Result(
        files=out, hmain_filled=counters["hmain"], sh_set=counters["sh"], changes=changes,
    )


# ─── แก้ไขรหัส TMT ยา ─────────────────────────────────────────────────────────
# แทนที่รหัส TMT เก่า -> ใหม่ ใน 2 ที่ให้ตรงกัน:
#   BillItems (ใน BILLTRAN)      : Hosdrugcode=field[3], TMT=field[4]
#   DispensedItems (ใน BILLDISP) : Hosdrugcode=field[2], TMT=field[3]
# จับคู่ได้ 2 แบบ: (ก) รหัส TMT เดิม  (ข) Hosdrugcode (ทนทานกว่าเมื่อ TMT เดิมไม่ตรงกัน)
BILLITEMS_HOSCODE_IDX = 3
BILLITEMS_TMT_IDX = 4
DISPITEMS_HOSCODE_IDX = 2
DISPITEMS_TMT_IDX = 3


@dataclass
class TmtRule:
    new_tmt: str
    old_tmt: str = ""        # จับคู่ด้วยรหัส TMT เดิม
    hosdrugcode: str = ""    # หรือจับคู่ด้วย Hosdrugcode


@dataclass
class TmtFixResult:
    files: Dict[str, bytes]
    changes: List[str] = field(default_factory=list)
    billitems_changed: int = 0
    dispitems_changed: int = 0


def _match_tmt_rule(rules: List[TmtRule], hoscode: str, tmt: str) -> Optional[str]:
    """คืน new_tmt ถ้าแถวนี้ตรงกฎข้อใดข้อหนึ่ง (Hosdrugcode มาก่อน TMT เดิม)"""
    hoscode = _norm(hoscode)
    tmt = _norm(tmt)
    for r in rules:
        if r.hosdrugcode and hoscode == _norm(r.hosdrugcode):
            return r.new_tmt
    for r in rules:
        if r.old_tmt and tmt == _norm(r.old_tmt):
            return r.new_tmt
    return None


def preview_tmt_fix(files: Dict[str, bytes], rules: List[TmtRule]) -> dict:
    """ดูว่ารายการยาแถวไหนใน BillItems / DispensedItems จะถูกแก้ TMT"""
    rules = [r for r in rules if _norm(r.new_tmt) and (_norm(r.old_tmt) or _norm(r.hosdrugcode))]
    if not rules:
        raise ValueError("ต้องระบุกฎแก้ TMT อย่างน้อย 1 ข้อ (รหัสใหม่ + รหัสเดิม หรือ Hosdrugcode)")

    rows_out: List[dict] = []
    bi_cnt = di_cnt = 0

    billtran_name = _find(files, "BILLTRAN")
    if billtran_name:
        bt = CsopFile.parse(files[billtran_name])
        for row in bt.section_rows("BillItems"):
            if len(row) <= BILLITEMS_TMT_IDX:
                continue
            hoscode = _norm(row[BILLITEMS_HOSCODE_IDX])
            tmt = _norm(row[BILLITEMS_TMT_IDX])
            new = _match_tmt_rule(rules, hoscode, tmt)
            if new and new != tmt:
                bi_cnt += 1
                rows_out.append({
                    "file": "BillItems", "invno": _norm(row[0]),
                    "hosdrugcode": hoscode, "desc": _norm(row[5]) if len(row) > 5 else "",
                    "current_tmt": tmt, "new_tmt": new,
                })

    billdisp_name = _find(files, "BILLDISP")
    if billdisp_name:
        bd = CsopFile.parse(files[billdisp_name])
        for row in bd.section_rows("DispensedItems"):
            if len(row) <= DISPITEMS_TMT_IDX:
                continue
            hoscode = _norm(row[DISPITEMS_HOSCODE_IDX])
            tmt = _norm(row[DISPITEMS_TMT_IDX])
            new = _match_tmt_rule(rules, hoscode, tmt)
            if new and new != tmt:
                di_cnt += 1
                rows_out.append({
                    "file": "DispensedItems", "invno": _norm(row[0]),
                    "hosdrugcode": hoscode, "desc": _norm(row[5]) if len(row) > 5 else "",
                    "current_tmt": tmt, "new_tmt": new,
                })

    return {
        "billtran_file": billtran_name,
        "billdisp_file": billdisp_name,
        "billitems_change_count": bi_cnt,
        "dispitems_change_count": di_cnt,
        "total_change_count": bi_cnt + di_cnt,
        "rows": rows_out,
    }


def apply_tmt_fix(files: Dict[str, bytes], rules: List[TmtRule]) -> TmtFixResult:
    """แก้รหัส TMT ใน BillItems (BILLTRAN) และ DispensedItems (BILLDISP) แล้วเซ็น Checksum ใหม่"""
    rules = [r for r in rules if _norm(r.new_tmt) and (_norm(r.old_tmt) or _norm(r.hosdrugcode))]
    if not rules:
        raise ValueError("ต้องระบุกฎแก้ TMT อย่างน้อย 1 ข้อ (รหัสใหม่ + รหัสเดิม หรือ Hosdrugcode)")

    out: Dict[str, bytes] = dict(files)
    counters = {"bi": 0, "di": 0}
    changes: List[str] = []

    billtran_name = _find(files, "BILLTRAN")
    if billtran_name:
        bt = CsopFile.parse(files[billtran_name])

        def fix_bi(cols: List[str]) -> Optional[List[str]]:
            if len(cols) <= BILLITEMS_TMT_IDX:
                return None
            new = _match_tmt_rule(rules, cols[BILLITEMS_HOSCODE_IDX], cols[BILLITEMS_TMT_IDX])
            if new and new != _norm(cols[BILLITEMS_TMT_IDX]):
                counters["bi"] += 1
                return _set_field(list(cols), BILLITEMS_TMT_IDX, new)
            return None

        bt.edit_section("BillItems", fix_bi)
        out[billtran_name] = bt.to_bytes()
        if counters["bi"]:
            changes.append(f"{billtran_name}: แก้ TMT ใน BillItems {counters['bi']} รายการ")

    billdisp_name = _find(files, "BILLDISP")
    if billdisp_name:
        bd = CsopFile.parse(files[billdisp_name])

        def fix_di(cols: List[str]) -> Optional[List[str]]:
            if len(cols) <= DISPITEMS_TMT_IDX:
                return None
            new = _match_tmt_rule(rules, cols[DISPITEMS_HOSCODE_IDX], cols[DISPITEMS_TMT_IDX])
            if new and new != _norm(cols[DISPITEMS_TMT_IDX]):
                counters["di"] += 1
                return _set_field(list(cols), DISPITEMS_TMT_IDX, new)
            return None

        bd.edit_section("DispensedItems", fix_di)
        out[billdisp_name] = bd.to_bytes()
        if counters["di"]:
            changes.append(f"{billdisp_name}: แก้ TMT ใน DispensedItems {counters['di']} รายการ")

    return TmtFixResult(
        files=out, changes=changes,
        billitems_changed=counters["bi"], dispitems_changed=counters["di"],
    )


# ─── ปรับยอดรวมใน BILLTRAN ให้ตรงผลรวม BillItems (ติด C รหัส A04 / T33 / T45) ──
# ยอดรวม (ฟิลด์ 9) ต้องเท่ากับผลรวม "รวมเป็นเงิน" ของ BillItems
# ยอดขอเบิก (ฟิลด์ 17) ต้องเท่ากับผลรวม "จำนวนเงินที่ขอเบิก" ของ BillItems
# ส่วนต่างเกิดเมื่อ HIS ส่งยอดหัวบิลไม่ตรงกับรายการย่อย (เช่น รายการถูกลบทีหลัง)


def _money(v: str) -> Decimal:
    try:
        return Decimal((v or "0").strip() or "0")
    except InvalidOperation:
        return Decimal("0")


def _fmt_money(v: Decimal) -> str:
    return f"{v.quantize(Decimal('0.01')):.2f}"


def _billitem_totals(bt: "CsopFile") -> Dict[str, Dict[str, Decimal]]:
    """ผลรวมต่อ Inv.no จาก BillItems: ยอดรายการ / ที่ขอเบิก"""
    totals: Dict[str, Dict[str, Decimal]] = {}
    for row in bt.section_rows("BillItems"):
        if len(row) <= BILLITEMS_REQUESTED_IDX:
            continue
        invno = _norm(row[0])
        if not invno:
            continue
        acc = totals.setdefault(invno, {"amount": Decimal("0"), "requested": Decimal("0")})
        acc["amount"] += _money(row[BILLITEMS_AMOUNT_IDX])
        acc["requested"] += _money(row[BILLITEMS_REQUESTED_IDX])
    return totals


def _total_targets(files: Dict[str, bytes]) -> tuple:
    """หา BILLTRAN แถวที่ยอดหัวบิลไม่ตรงผลรวมรายการ"""
    billtran_name = _find(files, "BILLTRAN")
    if not billtran_name:
        raise ValueError("ไม่พบไฟล์ BILLTRAN ในชุดที่อัปโหลด")
    bt = CsopFile.parse(files[billtran_name])
    totals = _billitem_totals(bt)

    targets: List[dict] = []
    for row in bt.section_rows("BILLTRAN"):
        if len(row) <= BILLTRAN_CLAIMAMT_IDX:
            continue
        invno = _norm(row[BILLTRAN_INVNO_IDX])
        acc = totals.get(invno)
        if not acc:
            continue
        cur_amt = _money(row[BILLTRAN_AMOUNT_IDX])
        cur_claim = _money(row[BILLTRAN_CLAIMAMT_IDX])
        new_amt, new_claim = acc["amount"], acc["requested"]
        if cur_amt == new_amt and cur_claim == new_claim:
            continue
        targets.append({
            "invno": invno,
            "current_amount": _fmt_money(cur_amt),
            "new_amount": _fmt_money(new_amt),
            "amount_diff": _fmt_money(new_amt - cur_amt),
            "current_claim": _fmt_money(cur_claim),
            "new_claim": _fmt_money(new_claim),
            "claim_diff": _fmt_money(new_claim - cur_claim),
        })
    return billtran_name, targets


def preview_total_sync(files: Dict[str, bytes]) -> dict:
    """ดูว่า visit ไหนยอดหัวบิลไม่ตรงผลรวมรายการ (ยังไม่แก้ไฟล์)"""
    billtran_name, targets = _total_targets(files)
    return {
        "billtran_file": billtran_name,
        "total_change_count": len(targets),
        "rows": targets,
    }


def apply_total_sync(files: Dict[str, bytes]) -> "OpdFeeFixResult":
    """ปรับยอดรวม/ยอดขอเบิกใน BILLTRAN ให้ตรงผลรวม BillItems แล้วเซ็น Checksum ใหม่"""
    billtran_name, targets = _total_targets(files)
    if not targets:
        raise ValueError("ยอดใน BILLTRAN ตรงกับผลรวม BillItems อยู่แล้ว")

    want = {t["invno"]: t for t in targets}
    bt = CsopFile.parse(files[billtran_name])
    counter = {"n": 0}

    def fix(cols: List[str]) -> Optional[List[str]]:
        if len(cols) <= BILLTRAN_CLAIMAMT_IDX:
            return None
        t = want.get(_norm(cols[BILLTRAN_INVNO_IDX]))
        if not t:
            return None
        new = list(cols)
        _set_field(new, BILLTRAN_AMOUNT_IDX, t["new_amount"])
        _set_field(new, BILLTRAN_CLAIMAMT_IDX, t["new_claim"])
        counter["n"] += 1
        return new

    bt.edit_section("BILLTRAN", fix)
    out: Dict[str, bytes] = dict(files)
    out[billtran_name] = bt.to_bytes()
    changes = [f"{billtran_name}: ปรับยอดรวม/ยอดขอเบิกให้ตรงผลรวมรายการ {counter['n']} visit"] if counter["n"] else []
    return OpdFeeFixResult(files=out, changes=changes, rows_changed=counter["n"])


# ─── แก้วันที่ให้บริการใน BillItems (ติด C รหัส T42) ───────────────────────────
# T42 : SVDATE ไม่สัมพันธ์กับ BILLTRAN
# วันที่ของแต่ละรายการใน BillItems (ฟิลด์ที่ 2) ต้องตรงกับวัน visit ใน BILLTRAN
# (ฟิลด์ที่ 3 = วันเวลาที่รับบริการ) — แถวไหนไม่ตรงให้แก้ตามวัน visit
BILLTRAN_SVDATE_IDX = 2     # วันเวลาที่รับบริการ (ฟิลด์ที่ 3) เช่น 2026-03-02 07:52:53
BILLITEMS_DATE_IDX = 1      # วันที่ของรายการ (ฟิลด์ที่ 2) เช่น 2026-03-02


@dataclass
class SvDateFixResult:
    files: Dict[str, bytes]
    changes: List[str] = field(default_factory=list)
    rows_changed: int = 0


def _visit_dates(bt: "CsopFile") -> Dict[str, str]:
    """InvNo -> วันที่ visit (เอาเฉพาะส่วนวัน YYYY-MM-DD)"""
    out: Dict[str, str] = {}
    for row in bt.section_rows("BILLTRAN"):
        if len(row) <= BILLTRAN_INVNO_IDX:
            continue
        invno = _norm(row[BILLTRAN_INVNO_IDX])
        svdate = _norm(row[BILLTRAN_SVDATE_IDX])[:10]
        if invno and svdate:
            out[invno] = svdate
    return out


def _svdate_targets(
    files: Dict[str, bytes],
    force_date: str = "",
) -> tuple[Optional[str], List[dict], List[dict]]:
    """
    หาแถว BillItems ที่วันที่ไม่ตรงกับวัน visit
    คืน (ชื่อไฟล์ BILLTRAN, แถวที่ต้องแก้, แถวในแฟ้มอื่นที่วันที่ไม่ตรง — แจ้งเตือนเฉยๆ)
    force_date : บังคับใช้วันที่นี้แทนวัน visit (ว่าง = ใช้วัน visit จาก BILLTRAN)
    """
    billtran_name = _find(files, "BILLTRAN")
    if not billtran_name:
        raise ValueError("ไม่พบไฟล์ BILLTRAN ในชุดที่อัปโหลด")

    bt = CsopFile.parse(files[billtran_name])
    visits = _visit_dates(bt)
    if not visits:
        raise ValueError("อ่านวันที่ visit จาก BILLTRAN ไม่ได้")

    forced = _norm(force_date)
    targets: List[dict] = []
    for row in bt.section_rows("BillItems"):
        if len(row) <= BILLITEMS_DESC_IDX:
            continue
        invno = _norm(row[0])
        current = _norm(row[BILLITEMS_DATE_IDX])
        want = forced or visits.get(invno, "")
        if not want or not current or current == want:
            continue
        targets.append({
            "invno": invno,
            "desc": _norm(row[BILLITEMS_DESC_IDX]),
            "local_code": _norm(row[3]),
            "std_code": _norm(row[BILLITEMS_STDCODE_IDX]),
            "amount": _norm(row[BILLITEMS_AMOUNT_IDX]) if len(row) > BILLITEMS_AMOUNT_IDX else "",
            "current_date": current,
            "visit_date": want,
        })

    # ตรวจแฟ้มอื่นด้วย (ไม่แก้ — ถ้าไม่ตรงแปลว่าอาจเป็นวัน visit เองที่ผิด)
    others: List[dict] = []
    ops_name = _find(files, "OPSERVICES")
    if ops_name:
        ops = CsopFile.parse(files[ops_name])
        for row in ops.section_rows("OPServices"):
            if len(row) <= 14:
                continue
            invno = _norm(row[0])
            d = _norm(row[13])[:10]
            want = visits.get(invno, "")
            if want and d and d != want:
                others.append({"file": ops_name, "invno": invno, "date": d, "visit_date": want})
    return billtran_name, targets, others


def preview_svdate_fix(files: Dict[str, bytes], force_date: str = "") -> dict:
    """ดูว่าแถวไหนใน BillItems มีวันที่ไม่ตรงกับวัน visit (ยังไม่แก้ไฟล์)"""
    billtran_name, targets, others = _svdate_targets(files, force_date)
    bt = CsopFile.parse(files[billtran_name])
    return {
        "billtran_file": billtran_name,
        "total_change_count": len(targets),
        "rows": targets,
        "other_mismatches": others,
        "visit_dates": _visit_dates(bt),
    }


def apply_svdate_fix(files: Dict[str, bytes], force_date: str = "") -> SvDateFixResult:
    """แก้วันที่ของรายการใน BillItems ให้ตรงวัน visit แล้วเซ็น Checksum ใหม่"""
    billtran_name, targets, _ = _svdate_targets(files, force_date)
    if not targets:
        raise ValueError("ไม่พบแถวที่ต้องแก้ — วันที่ของทุกรายการตรงกับวัน visit อยู่แล้ว")

    bt = CsopFile.parse(files[billtran_name])
    visits = _visit_dates(bt)
    forced = _norm(force_date)
    out: Dict[str, bytes] = dict(files)
    counter = {"n": 0}

    def fix(cols: List[str]) -> Optional[List[str]]:
        if len(cols) <= BILLITEMS_DATE_IDX:
            return None
        want = forced or visits.get(_norm(cols[0]), "")
        current = _norm(cols[BILLITEMS_DATE_IDX])
        if not want or not current or current == want:
            return None
        counter["n"] += 1
        return _set_field(list(cols), BILLITEMS_DATE_IDX, want)

    bt.edit_section("BillItems", fix)
    out[billtran_name] = bt.to_bytes()

    changes = [f"{billtran_name}: แก้วันที่ให้บริการใน BillItems {counter['n']} รายการ"] if counter["n"] else []
    return SvDateFixResult(files=out, changes=changes, rows_changed=counter["n"])


# ─── เติมยอดเบิกค่าบริการทั่วไป ผป.นอก (ติด C รหัส T33 / 45) ──────────────────
# แถว BillItems ของ "ค่าบริการทั่วไปผู้ป่วยนอก ในเวลาราชการ" ส่งมาโดยมี
# จำนวนเงินที่เบิกได้ (ฟิลด์ 10) และจำนวนเงินที่ขอเบิก (ฟิลด์ 11) เป็น 0.00
# ทั้งที่มียอดรายการ (ฟิลด์ 9) อยู่ -> ต้องเติมให้เท่ายอดรายการ
#
# แถว BillItems: [0]InvNo [1]date [2]BillMu [3]LocalCode [4]STDCode [5]desc
#                [6]qty [7]UnitPrice [8]Amount [9]Claimable [10]Requested
#                [11]SvPID [12]Ward
BILLITEMS_STDCODE_IDX = 4
BILLITEMS_DESC_IDX = 5
BILLITEMS_CLAIMABLE_IDX = 9    # จำนวนเงินที่เบิกได้ (ฟิลด์ที่ 10)
BILLITEMS_REQUESTED_IDX = 10   # จำนวนเงินที่ขอเบิก (ฟิลด์ที่ 11)
OPD_SERVICE_FEE_CODE = "55020"  # ค่าบริการทั่วไปผู้ป่วยนอก ในเวลาราชการ
ZERO_AMOUNT = "0.00"


@dataclass
class OpdFeeFixResult:
    files: Dict[str, bytes]
    changes: List[str] = field(default_factory=list)
    rows_changed: int = 0


def _opd_fee_targets(
    files: Dict[str, bytes],
    codes: Optional[set] = None,
    amount: str = "",
) -> tuple[Optional[str], List[dict]]:
    """
    หาแถว BillItems ที่ต้องเติมยอดเบิก
    codes  : รหัสมาตรฐาน (ฟิลด์ 5) ที่ถือว่าเป็นค่าบริการทั่วไป — default {55020}
    amount : ยอดที่จะเติม; ว่าง = ใช้ยอดของรายการนั้นเอง (ฟิลด์ 9)
    """
    billtran_name = _find(files, "BILLTRAN")
    if not billtran_name:
        raise ValueError("ไม่พบไฟล์ BILLTRAN ในชุดที่อัปโหลด")

    codes = {_norm(c) for c in (codes or {OPD_SERVICE_FEE_CODE}) if _norm(c)}
    if not codes:
        raise ValueError("ต้องระบุรหัสรายการอย่างน้อย 1 รหัส")

    bt = CsopFile.parse(files[billtran_name])
    targets: List[dict] = []
    for row in bt.section_rows("BillItems"):
        if len(row) <= BILLITEMS_REQUESTED_IDX:
            continue
        if _norm(row[BILLITEMS_STDCODE_IDX]) not in codes:
            continue
        claimable = _norm(row[BILLITEMS_CLAIMABLE_IDX])
        requested = _norm(row[BILLITEMS_REQUESTED_IDX])
        if claimable != ZERO_AMOUNT and requested != ZERO_AMOUNT:
            continue  # กรอกมาแล้ว ไม่ต้องแตะ
        new_amount = _norm(amount) or _norm(row[BILLITEMS_AMOUNT_IDX])
        if not new_amount or new_amount == ZERO_AMOUNT:
            continue  # ยอดรายการเป็น 0 เอง — ไม่ใช่เคสนี้
        targets.append({
            "invno": _norm(row[0]),
            "date": _norm(row[1]),
            "local_code": _norm(row[3]),
            "std_code": _norm(row[BILLITEMS_STDCODE_IDX]),
            "desc": _norm(row[BILLITEMS_DESC_IDX]),
            "amount": _norm(row[BILLITEMS_AMOUNT_IDX]),
            "current_claimable": claimable,
            "current_requested": requested,
            "new_value": new_amount,
        })
    return billtran_name, targets


def preview_opd_fee_fix(
    files: Dict[str, bytes],
    codes: Optional[set] = None,
    amount: str = "",
) -> dict:
    """ดูว่าแถวไหนใน BillItems จะถูกเติมยอดเบิก (ยังไม่แก้ไฟล์)"""
    billtran_name, targets = _opd_fee_targets(files, codes, amount)
    return {
        "billtran_file": billtran_name,
        "total_change_count": len(targets),
        "rows": targets,
    }


def apply_opd_fee_fix(
    files: Dict[str, bytes],
    codes: Optional[set] = None,
    amount: str = "",
) -> OpdFeeFixResult:
    """เติมจำนวนเงินที่เบิกได้/ขอเบิก ใน BillItems แล้วเซ็น Checksum ใหม่"""
    billtran_name, targets = _opd_fee_targets(files, codes, amount)
    if not targets:
        raise ValueError(
            "ไม่พบแถวที่ต้องแก้ — ไม่มีรายการที่ตรงรหัสและมียอดเบิกเป็น 0.00 "
            "(ถ้ารหัสรายการของ รพ. ต่างจาก 55020 ให้ระบุรหัสเพิ่มในช่องตั้งค่า)"
        )

    codes_set = {_norm(c) for c in (codes or {OPD_SERVICE_FEE_CODE}) if _norm(c)}
    out: Dict[str, bytes] = dict(files)
    bt = CsopFile.parse(files[billtran_name])
    counter = {"n": 0}

    def fix(cols: List[str]) -> Optional[List[str]]:
        if len(cols) <= BILLITEMS_REQUESTED_IDX:
            return None
        if _norm(cols[BILLITEMS_STDCODE_IDX]) not in codes_set:
            return None
        claimable = _norm(cols[BILLITEMS_CLAIMABLE_IDX])
        requested = _norm(cols[BILLITEMS_REQUESTED_IDX])
        if claimable != ZERO_AMOUNT and requested != ZERO_AMOUNT:
            return None
        new_amount = _norm(amount) or _norm(cols[BILLITEMS_AMOUNT_IDX])
        if not new_amount or new_amount == ZERO_AMOUNT:
            return None
        new = list(cols)
        if claimable == ZERO_AMOUNT:
            _set_field(new, BILLITEMS_CLAIMABLE_IDX, new_amount)
        if requested == ZERO_AMOUNT:
            _set_field(new, BILLITEMS_REQUESTED_IDX, new_amount)
        counter["n"] += 1
        return new

    bt.edit_section("BillItems", fix)
    out[billtran_name] = bt.to_bytes()

    changes = [f"{billtran_name}: เติมจำนวนเงินที่เบิกได้/ขอเบิก {counter['n']} รายการ"] if counter["n"] else []
    return OpdFeeFixResult(files=out, changes=changes, rows_changed=counter["n"])


# ─── แก้รหัสหัตถการใน OPServices (ติด C รหัส S19 / S41) ────────────────────────
# S41 : Class = OP (หัตถการ) แต่ STDCode ว่าง  -> ต้องเติมรหัสหัตถการ
# S19 : STDCode ไม่ถูกต้อง/ไม่สัมพันธ์กับ CodeSet -> ต้องแทนที่ด้วยรหัสที่ถูก
#
# แถว OPServices (คั่นด้วย |):
#   [0]InvNo [1]ItemID [2]Class [3]HCODE [4]HN [5]PID ... [15]LocalCode [16]CodeType
#   [17]STDCode [18]Amount [19]UseStatus [20]SvPID [21]Ward
OPSERVICES_ITEMID_IDX = 1
OPSERVICES_LOCALCODE_IDX = 15
OPSERVICES_CODETYPE_IDX = 16
OPSERVICES_STDCODE_IDX = 17
OPSERVICES_AMOUNT_IDX = 18
CLASS_PROCEDURE = "OP"


@dataclass
class StdCodeFixResult:
    files: Dict[str, bytes]
    changes: List[str] = field(default_factory=list)
    filled: int = 0       # S41: เติมช่องว่าง
    replaced: int = 0     # S19: แทนที่รหัสที่ไม่ถูก
    unresolved: int = 0   # ยังหารหัสไม่ได้ — ต้องกรอกเอง


def learn_stdcode_map(files: Dict[str, bytes]) -> Dict[str, str]:
    """
    เรียนรู้คู่ LocalCode -> STDCode จากแถวในไฟล์เอง (แถวที่กรอกครบอยู่แล้ว)
    ใช้กรณีที่พบบ่อย: รายการเดียวกันมีหลายแถว แต่มีบางแถวที่ STDCode หลุดไป
    ถ้า LocalCode เดียวกันมี STDCode ขัดกันเอง จะไม่ใช้ (กันเดาผิด)
    """
    seen: Dict[str, set] = {}
    ops_name = _find(files, "OPSERVICES")
    if not ops_name:
        return {}
    ops = CsopFile.parse(files[ops_name])
    for row in ops.section_rows("OPServices"):
        if len(row) <= OPSERVICES_STDCODE_IDX:
            continue
        local = _norm(row[OPSERVICES_LOCALCODE_IDX])
        std = _norm(row[OPSERVICES_STDCODE_IDX])
        if local and std:
            seen.setdefault(local, set()).add(std)
    return {k: next(iter(v)) for k, v in seen.items() if len(v) == 1}


def _resolve_stdcode(
    local: str,
    current: str,
    library: Dict[str, str],
    learned: Dict[str, str],
    replace_existing: bool,
) -> tuple[Optional[str], str]:
    """
    คืน (รหัสที่ควรใช้, ที่มา) — คืน (None, "") ถ้าไม่ต้องแก้หรือหาไม่ได้
    ลำดับความน่าเชื่อถือ: คลังรหัสที่ผู้ใช้บันทึกไว้ > ที่เรียนรู้จากไฟล์เดียวกัน
    """
    if not local:
        return None, ""
    from_lib = _norm(library.get(local, ""))
    from_file = _norm(learned.get(local, ""))

    if not current:                       # S41 — ช่องว่าง
        if from_lib:
            return from_lib, "คลังรหัส"
        if from_file:
            return from_file, "ไฟล์นี้"
        return None, ""

    # S19 — มีรหัสอยู่แล้วแต่คลังรหัสบอกว่าเป็นอีกรหัส (แก้เมื่อผู้ใช้สั่งเท่านั้น)
    if replace_existing and from_lib and from_lib != current:
        return from_lib, "คลังรหัส"
    return None, ""


def _stdcode_targets(
    files: Dict[str, bytes],
    library: Dict[str, str],
    use_file_learning: bool,
    replace_existing: bool,
) -> tuple[Optional[str], List[dict], List[dict]]:
    """สแกน OPServices -> (ชื่อไฟล์, แถวที่แก้ได้, แถวที่ยังหารหัสไม่ได้)"""
    ops_name = _find(files, "OPSERVICES")
    if not ops_name:
        raise ValueError("ไม่พบไฟล์ OPServices ในชุดที่อัปโหลด")

    library = {_norm(k): _norm(v) for k, v in (library or {}).items() if _norm(k) and _norm(v)}
    learned = learn_stdcode_map(files) if use_file_learning else {}

    ops = CsopFile.parse(files[ops_name])
    fixable: List[dict] = []
    unresolved: List[dict] = []

    for row in ops.section_rows("OPServices"):
        if len(row) <= OPSERVICES_STDCODE_IDX:
            continue
        if _norm(row[OPSERVICES_CLASS_IDX]) != CLASS_PROCEDURE:
            continue  # แถว EC (ระดับ visit) ไม่ต้องมีรหัสหัตถการ
        local = _norm(row[OPSERVICES_LOCALCODE_IDX])
        current = _norm(row[OPSERVICES_STDCODE_IDX])
        new, source = _resolve_stdcode(local, current, library, learned, replace_existing)
        info = {
            "invno": _norm(row[0]),
            "item_id": _norm(row[OPSERVICES_ITEMID_IDX]),
            "local_code": local,
            "current_stdcode": current,
            "amount": _norm(row[OPSERVICES_AMOUNT_IDX]) if len(row) > OPSERVICES_AMOUNT_IDX else "",
        }
        if new:
            fixable.append({**info, "new_stdcode": new, "source": source,
                            "issue": "S41" if not current else "S19"})
        elif not current:
            unresolved.append({**info, "issue": "S41"})

    return ops_name, fixable, unresolved


def preview_stdcode_fix(
    files: Dict[str, bytes],
    library: Optional[Dict[str, str]] = None,
    use_file_learning: bool = True,
    replace_existing: bool = False,
) -> dict:
    """ดูว่าแถวไหนใน OPServices จะถูกเติม/แก้รหัสหัตถการ (ยังไม่แก้ไฟล์)"""
    ops_name, fixable, unresolved = _stdcode_targets(
        files, library or {}, use_file_learning, replace_existing
    )
    learned = learn_stdcode_map(files) if use_file_learning else {}
    return {
        "opservices_file": ops_name,
        "fill_count": sum(1 for r in fixable if r["issue"] == "S41"),
        "replace_count": sum(1 for r in fixable if r["issue"] == "S19"),
        "total_change_count": len(fixable),
        "unresolved_count": len(unresolved),
        "rows": fixable,
        "unresolved": unresolved,
        "learned_map": learned,
    }


def apply_stdcode_fix(
    files: Dict[str, bytes],
    library: Optional[Dict[str, str]] = None,
    use_file_learning: bool = True,
    replace_existing: bool = False,
) -> StdCodeFixResult:
    """เติม/แก้รหัสหัตถการ (STDCode) ใน OPServices แล้วเซ็น Checksum ใหม่"""
    ops_name, fixable, unresolved = _stdcode_targets(
        files, library or {}, use_file_learning, replace_existing
    )
    if not fixable:
        raise ValueError(
            "ไม่มีแถวที่แก้ได้ — "
            + (f"มี {len(unresolved)} แถวที่ STDCode ว่างแต่ยังไม่รู้รหัสที่ถูกต้อง "
               "กรุณาระบุรหัสในคลังรหัสหัตถการก่อน"
               if unresolved else "ไฟล์นี้ไม่พบปัญหา S19/S41")
        )

    # ทำ index ด้วย ItemID (ไม่ซ้ำในไฟล์) เพื่อแก้ให้ตรงแถวเป๊ะ
    by_item = {r["item_id"]: r["new_stdcode"] for r in fixable}
    out: Dict[str, bytes] = dict(files)
    ops = CsopFile.parse(files[ops_name])
    counters = {"fill": 0, "repl": 0}

    def fix(cols: List[str]) -> Optional[List[str]]:
        if len(cols) <= OPSERVICES_STDCODE_IDX:
            return None
        new = by_item.get(_norm(cols[OPSERVICES_ITEMID_IDX]))
        if not new or new == _norm(cols[OPSERVICES_STDCODE_IDX]):
            return None
        counters["fill" if not _norm(cols[OPSERVICES_STDCODE_IDX]) else "repl"] += 1
        return _set_field(list(cols), OPSERVICES_STDCODE_IDX, new)

    ops.edit_section("OPServices", fix)
    out[ops_name] = ops.to_bytes()

    changes: List[str] = []
    if counters["fill"]:
        changes.append(f"{ops_name}: เติมรหัสหัตถการที่ว่าง (S41) {counters['fill']} แถว")
    if counters["repl"]:
        changes.append(f"{ops_name}: แก้รหัสหัตถการที่ไม่ถูกต้อง (S19) {counters['repl']} แถว")
    if unresolved:
        changes.append(f"{ops_name}: ยังหารหัสไม่ได้ {len(unresolved)} แถว — ต้องกรอกเอง")

    return StdCodeFixResult(
        files=out, changes=changes,
        filled=counters["fill"], replaced=counters["repl"], unresolved=len(unresolved),
    )


def _find(files: Dict[str, bytes], keyword: str) -> Optional[str]:
    for name in files:
        if keyword in name.upper():
            return name
    return None


# ─── Output zip filename ──────────────────────────────────────────────────────

def build_zip_filename(files: Dict[str, bytes]) -> str:
    """
    สร้างชื่อไฟล์ zip ตามรูปแบบมาตรฐาน CSOP จาก header ของ BILLTRAN เช่น
        40922_CSOPBIL_1270_21_20260619-111954.zip
    = {HCODE}_{PayPlan}{System}BIL_{SESSNO}_{billtran_ver}_{YYYYMMDD-HHMMSS}.zip
    ถ้าดึงข้อมูลไม่ครบ จะ fallback เป็น cpap_fixed.zip
    """
    billtran_name = _find(files, "BILLTRAN")
    if not billtran_name:
        return "cpap_fixed.zip"
    try:
        bt = CsopFile.parse(files[billtran_name])
    except Exception:
        return "cpap_fixed.zip"

    head = bt.head_text
    hcode = _tag(head, "HCODE")
    sessno = _tag(head, "SESSNO")
    datetime_raw = _tag(head, "DATETIME")
    pay_plan = bt.pay_plan or "CS"
    system = bt.system or "OP"

    rows = bt.section_rows("BILLTRAN")
    ver = rows[0][0].strip() if rows and rows[0] else "21"

    # datetime -> YYYYMMDD-HHMMSS (เอาเฉพาะตัวเลข 14 หลักแรก)
    digits = re.sub(r"\D", "", datetime_raw)
    dt = f"{digits[:8]}-{digits[8:14]}" if len(digits) >= 14 else ""

    sess = f"{int(sessno):04d}" if sessno.isdigit() else sessno
    prefix = f"{pay_plan}{system}BIL"  # CS + OP + BIL = CSOPBIL

    if hcode and sess and ver and dt:
        return f"{hcode}_{prefix}_{sess}_{ver}_{dt}.zip"
    return "cpap_fixed.zip"


def _tag(head_text: str, name: str) -> str:
    m = re.search(rf"<{name}>([^<]*)</{name}>", head_text)
    return m.group(1).strip() if m else ""


# ─── Thai fiscal year ─────────────────────────────────────────────────────────

def thai_fiscal_year(date_str: str) -> Optional[int]:
    """
    คืนปีงบประมาณไทย (พ.ศ.) จากวันที่ Gregorian 'YYYY-MM-DD...'
    ปีงบประมาณเริ่ม 1 ต.ค. — เดือน >= 10 นับเป็นปีงบถัดไป
    เช่น 2026-03-31 -> 2569 ; 2025-11-20 -> 2569
    """
    m = re.match(r"(\d{4})-(\d{2})", (date_str or "").strip())
    if not m:
        return None
    year = int(m.group(1))
    month = int(m.group(2))
    buddhist = year + 543
    return buddhist + 1 if month >= 10 else buddhist


# ─── Analyze (สำหรับ UI: ดู visit CPAP + ค่าปัจจุบัน ก่อนแก้) ──────────────────

def analyze(files: Dict[str, bytes]) -> dict:
    """
    วิเคราะห์ชุดไฟล์ CSOP คืนข้อมูลสำหรับให้ผู้ใช้ตรวจ/กรอกรหัสอนุมัติ
    """
    result: dict = {
        "files": [],
        "pay_plan": "",
        "sessno": "",
        "service_date": "",
        "fiscal_year": None,
        "doctor_target": DEFAULT_DOCTOR_LICENSE,
        "cpap_visits": [],
        "needs_fix": False,
    }

    billtran_name = _find(files, "BILLTRAN")
    opsvc_name = _find(files, "OPSERVICES")

    # สถานะ checksum ของทุกไฟล์
    for name, raw in files.items():
        cv = verify_checksum(raw)
        result["files"].append({"name": name, "checksum_valid": cv})

    # หา visit ที่มี CPAP + ค่าปัจจุบันของแต่ละฟิลด์
    # หมายเหตุศัพท์: key ที่ใช้จับคู่ทุก section (BILLTRAN/OPServices field[0]/[4]) คือ
    # "เลข invoice no." (เช่น 249092) ส่วน "VN" จริงคือ ref ใน OPServices field[1] (เช่น 690206092115)
    bt_items_by_visit: Dict[str, List[dict]] = {}
    bt_authcode: Dict[str, str] = {}
    bt_name: Dict[str, str] = {}    # invoice no -> ชื่อผู้ป่วย (BILLTRAN field[13])
    if billtran_name:
        bt = CsopFile.parse(files[billtran_name])
        result["pay_plan"] = bt.pay_plan
        m_sess = re.search(r"<SESSNO>([^<]*)</SESSNO>", bt.head_text)
        if m_sess:
            result["sessno"] = m_sess.group(1).strip()
        for row in bt.section_rows("BILLTRAN"):
            if len(row) > 4:
                vno = row[4].strip()
                bt_authcode[vno] = row[BILLTRAN_AUTHCODE_IDX] if len(row) > BILLTRAN_AUTHCODE_IDX else ""
                bt_name[vno] = row[13].strip() if len(row) > 13 else ""
            # วันรับบริการตัวแทน = วันที่ใน BILLTRAN (field index 2)
            if not result["service_date"] and len(row) > 2:
                d = (row[2] or "").strip()[:10]
                if re.match(r"\d{4}-\d{2}-\d{2}", d):
                    result["service_date"] = d
                    result["fiscal_year"] = thai_fiscal_year(d)
        for row in bt.section_rows("BillItems"):
            if len(row) >= 6:
                vno = row[0].strip()
                ctype = classify_item_name(row[5] or "")
                bt_items_by_visit.setdefault(vno, []).append({
                    "code": row[3] if len(row) > 3 else "",
                    "name": row[5],
                    "amount": row[8] if len(row) > 8 else "",
                    "is_cpap": ctype == CLAIM_CPAP,
                    "claim_type": ctype,
                })

    op_by_visit: Dict[str, dict] = {}
    if opsvc_name:
        op = CsopFile.parse(files[opsvc_name])
        for row in op.section_rows("OPServices"):
            if row:
                vno = row[OPSERVICES_VISIT_IDX].strip()
                op_by_visit[vno] = {
                    "class": row[OPSERVICES_CLASS_IDX] if len(row) > OPSERVICES_CLASS_IDX else "",
                    "doctor": row[OPSERVICES_DOCTOR_IDX] if len(row) > OPSERVICES_DOCTOR_IDX else "",
                    "svpid": row[OPSERVICES_SVPID_IDX] if len(row) > OPSERVICES_SVPID_IDX else "",
                    "ref": row[1] if len(row) > 1 else "",
                }

    # จำแนกประเภทแต่ละ visit (CPAP มาก่อน PSG)
    for vno, items in bt_items_by_visit.items():
        types = [i.get("claim_type") for i in items if i.get("claim_type")]
        if CLAIM_CPAP in types:
            claim_type = CLAIM_CPAP
        elif CLAIM_PSG in types:
            claim_type = CLAIM_PSG
        else:
            continue  # visit นี้ไม่ใช่เคส CPAP/PSG

        op_info = op_by_visit.get(vno, {})
        cur_authcode = (bt_authcode.get(vno, "") or "").strip()
        cur_class = (op_info.get("class", "") or "").strip()
        cur_doctor = (op_info.get("doctor", "") or "").strip()
        cur_svpid = (op_info.get("svpid", "") or "").strip()

        doctor_target = DOCTOR_BY_CLAIM.get(claim_type, "")
        doctor_name = DOCTOR_NAME_BY_CLAIM.get(claim_type, "")

        # CPAP ต้องมี STCPAP ด้วย; PSG ไม่ยุ่ง BILLTRAN
        needs = (cur_class != "ED") or (not cur_svpid) or (cur_doctor != doctor_target)
        if claim_type == CLAIM_CPAP:
            needs = needs or (cur_authcode != "STCPAP")
        if needs:
            result["needs_fix"] = True

        result["cpap_visits"].append({
            "visit_no": vno,                         # = invoice no. (key สำหรับจับคู่/apply)
            "invno": vno,                            # invoice no. (เช่น 249092)
            "vn": (op_info.get("ref", "") or "").strip(),  # VN จริง (เช่น 690206092115)
            "patient_name": bt_name.get(vno, ""),
            "claim_type": claim_type,
            "doctor_target": doctor_target,
            "doctor_name": doctor_name,
            "items": items,
            "current": {"authcode": cur_authcode, "class": cur_class, "doctor": cur_doctor, "svpid": cur_svpid},
            "needs_fix": needs,
        })

    return result
