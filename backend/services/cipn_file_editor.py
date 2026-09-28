"""
แก้ไขไฟล์ CIPN / AIPN (ผู้ป่วยใน) แบบรักษาไบต์เดิม แล้วเซ็นลายเซ็นท้ายไฟล์ใหม่

โครงสร้างไฟล์ (CIPN v2.1, encoding windows-874):
  <CIPN>
    <Header>...</Header>            ← แท็กเดี่ยว (ค่าเดียวต่อแท็ก)
    <ClaimAuth>...</ClaimAuth>      ← แท็กเดี่ยว
    <IPADT> แถวคั่นด้วย | </IPADT>   ← 1 แถว 22 ฟิลด์ (ข้อมูลการรับไว้)
    <IPDx> ... </IPDx>              ← หลายแถว 7 ฟิลด์ (วินิจฉัย)
    <IPOp> ... </IPOp>              ← หลายแถว 8 ฟิลด์ (หัตถการ)
    <Invoices><BillItems> ... </BillItems></Invoices>  ← หลายแถว 18 ฟิลด์
    <Coinsurance><Insurance>...</Insurance></Coinsurance>
  </CIPN>
  <?EndNote HMAC="..."?>

ต่างจากแฟ้ม OPD ตรงลายเซ็น: OPD ใช้ MD5 ตรงๆ ส่วน CIPN ใช้ HMAC ที่ต้องมี
"คีย์ของโรงพยาบาล" จึงเซ็นได้ — ดู services/aipn_signer.py
"""
import re
from dataclasses import dataclass
from typing import Callable, Dict, List, Optional

from services.aipn_signer import sign_endnote
from services.csop_file_editor import ENCODING, split_endnote

# ส่วนที่เป็นแถวคั่นด้วย | (แก้ได้เหมือนแฟ้ม OPD)
CIPN_ROW_SECTIONS = ["IPADT", "IPDx", "IPOp", "BillItems"]

# แท็กเดี่ยวที่แก้ได้ (ค่าอยู่ในบรรทัดเดียวกับแท็ก)
_LEAF_RE = re.compile(r"^(\s*)<([A-Za-z][\w]*)((?:\s[^>]*)?)>([^<]*)</\2>\s*$")


@dataclass
class CipnFile:
    """โมเดลไฟล์ CIPN แบบรักษาไบต์เดิม (แก้เฉพาะช่องที่สั่ง)"""
    head_text: str
    eol: str

    @classmethod
    def parse(cls, raw: bytes) -> "CipnFile":
        head, _ = split_endnote(raw)
        eol = "\r\n" if b"\r\n" in head else "\n"
        head_text = head.decode(ENCODING)
        if head_text.encode(ENCODING) != head:
            raise ValueError("cp874 round-trip mismatch — ไฟล์มีไบต์นอกชุด cp874")
        return cls(head_text=head_text, eol=eol)

    # ── แท็กเดี่ยว ────────────────────────────────────────────────────────────
    def leaf_tags(self) -> List[dict]:
        """คืนรายการแท็กเดี่ยวตามลำดับที่ปรากฏ: {tag, value, line}"""
        out: List[dict] = []
        for i, line in enumerate(self.head_text.split(self.eol)):
            m = _LEAF_RE.match(line)
            if m:
                out.append({"tag": m.group(2), "value": m.group(4), "line": i})
        return out

    def set_leaf(self, nth: int, value: str) -> None:
        """แก้ค่าแท็กเดี่ยวลำดับที่ nth (เริ่มที่ 0)"""
        tags = self.leaf_tags()
        if not 0 <= nth < len(tags):
            raise ValueError(f"ไม่พบแท็กลำดับที่ {nth + 1}")
        if "<" in value or ">" in value:
            raise ValueError("ค่าห้ามมีอักขระ < หรือ > เพราะจะทำให้โครงสร้าง XML เสีย")
        lines = self.head_text.split(self.eol)
        i = tags[nth]["line"]
        m = _LEAF_RE.match(lines[i])
        indent, tag, attrs = m.group(1), m.group(2), m.group(3)
        lines[i] = f"{indent}<{tag}{attrs}>{value}</{tag}>"
        self.head_text = self.eol.join(lines)

    # ── แถวคั่นด้วย | ─────────────────────────────────────────────────────────
    def section_rows(self, tag: str) -> List[List[str]]:
        rows: List[List[str]] = []
        inside = False
        for line in self.head_text.split(self.eol):
            s = line.strip()
            if s == f"<{tag}>":
                inside = True
                continue
            if s == f"</{tag}>":
                inside = False
                continue
            if inside and s and not s.startswith("<"):
                rows.append(line.split("|"))
        return rows

    def edit_section(self, tag: str, fn: Callable[[List[str]], Optional[List[str]]]) -> int:
        lines = self.head_text.split(self.eol)
        inside = False
        changed = 0
        for i, line in enumerate(lines):
            s = line.strip()
            if s == f"<{tag}>":
                inside = True
                continue
            if s == f"</{tag}>":
                inside = False
                continue
            if inside and s and not s.startswith("<"):
                cols = line.split("|")
                new_cols = fn(cols)
                if new_cols is not None and new_cols != cols:
                    lines[i] = "|".join(new_cols)
                    changed += 1
        self.head_text = self.eol.join(lines)
        return changed

    # ── serialize ────────────────────────────────────────────────────────────
    def to_bytes(self) -> bytes:
        """เซ็นลายเซ็นท้ายไฟล์ใหม่ — ต้องตั้งค่าคีย์/วิธีเซ็นไว้ก่อน"""
        head = self.head_text.encode(ENCODING)
        return head + sign_endnote(head).encode(ENCODING)


def is_cipn(raw: bytes) -> bool:
    return b"<CIPN>" in raw[:4096] or b'DocSysID version="2.1">AIPN' in raw[:4096]


def read_cipn(raw: bytes) -> dict:
    """อ่านไฟล์ CIPN -> โครงสร้างสำหรับแสดงเป็นตารางที่แก้ได้"""
    cf = CipnFile.parse(raw)
    sections: List[dict] = []

    tags = cf.leaf_tags()
    if tags:
        sections.append({
            "section": "#tags",
            "labels": ["แท็ก|ชื่อแท็กในไฟล์ (แก้ไม่ได้)", "ค่า|ค่าของแท็ก"],
            "rows": [[t["tag"], t["value"]] for t in tags],
            "readonly_fields": [0],
        })
    for tag in CIPN_ROW_SECTIONS:
        rows = cf.section_rows(tag)
        if not rows:
            continue
        width = max(len(r) for r in rows)
        sections.append({
            "section": tag,
            "labels": labels_for(tag, width),
            "rows": [r + [""] * (width - len(r)) for r in rows],
            "readonly_fields": [],
        })
    return {"sections": sections}


def apply_cipn_edits(raw: bytes, edits: List[dict]) -> bytes:
    """ใช้รายการแก้ไข {section,row,field,value} กับไฟล์ CIPN แล้วเซ็นใหม่"""
    cf = CipnFile.parse(raw)
    by_section: Dict[str, List[dict]] = {}
    for e in edits:
        by_section.setdefault(str(e.get("section", "")), []).append(e)

    for section, sec_edits in by_section.items():
        if section == "#tags":
            for e in sec_edits:
                if int(e["field"]) != 1:
                    raise ValueError("แก้ได้เฉพาะคอลัมน์ 'ค่า' ของแท็ก (ชื่อแท็กแก้ไม่ได้)")
                cf.set_leaf(int(e["row"]), str(e.get("value", "")))
            continue

        if section not in CIPN_ROW_SECTIONS:
            raise ValueError(f"ไม่รู้จักส่วน '{section}' ในไฟล์ CIPN")
        wanted: Dict[int, Dict[int, str]] = {}
        for e in sec_edits:
            wanted.setdefault(int(e["row"]), {})[int(e["field"])] = str(e.get("value", ""))

        counter = {"i": -1}
        applied = set()

        def fix(cols: List[str]) -> Optional[List[str]]:
            counter["i"] += 1
            patch = wanted.get(counter["i"])
            if not patch:
                return None
            new = list(cols)
            for f_idx, value in patch.items():
                if f_idx >= len(new):
                    raise ValueError(f"{section} แถว {counter['i'] + 1}: ไม่มีฟิลด์ที่ {f_idx + 1}")
                new[f_idx] = value
            applied.add(counter["i"])
            return new

        cf.edit_section(section, fix)
        missing = set(wanted) - applied
        if missing:
            raise ValueError(f"{section}: ไม่พบแถวที่ {sorted(m + 1 for m in missing)}")

    return cf.to_bytes()


# ─── ชื่อฟิลด์ตามโครงสร้าง AIPN (ยืนยันลำดับกับไฟล์จริงของ รพ.) ────────────────
FIELD_LABELS: Dict[str, List[str]] = {
    "IPADT": [
        "AN|เลขที่ผู้ป่วยใน (AN)",
        "HN|เลขประจำตัวผู้ป่วย (HN)",
        "SubHN|ลำดับย่อย",
        "PID|เลขบัตรประชาชน",
        "Prefix|คำนำหน้าชื่อ",
        "Name|ชื่อ-สกุลผู้ป่วย",
        "DOB|วันเกิด",
        "Sex|เพศ (1=ชาย 2=หญิง)",
        "RightCode|รหัสสิทธิ",
        "PayPlan|แผนการจ่าย",
        "Ward|หอผู้ป่วย",
        "RoomType|ประเภทห้อง",
        "AdmType|ประเภทการรับไว้",
        "AdmSource|ที่มาของผู้ป่วย",
        "AdmDT|วันเวลารับไว้",
        "DchDT|วันเวลาจำหน่าย",
        "DchStatus|สถานะจำหน่าย",
        "DchType|ประเภทการจำหน่าย",
        "LOS|จำนวนวันนอน",
        "AdjRW|ค่าน้ำหนักสัมพัทธ์ (AdjRW)",
        "PayType|ประเภทการชำระ",
        "ClaimCat|ประเภทการเบิก",
    ],
    "IPDx": [
        "Seq|ลำดับ",
        "DxType|ชนิดการวินิจฉัย (1=โรคหลัก 2=โรคร่วม 5=สาเหตุ)",
        "CodeSet|ชุดรหัสโรค",
        "ICD|รหัสโรค (ICD-10)",
        "Desc|คำอธิบายโรค",
        "Doctor|แพทย์ผู้วินิจฉัย",
        "DxDT|วันเวลาที่วินิจฉัย",
    ],
    "IPOp": [
        "Seq|ลำดับ",
        "CodeSet|ชุดรหัสหัตถการ",
        "Code|รหัสหัตถการ (ICD-9-CM)",
        "Desc|คำอธิบายหัตถการ",
        "Doctor|แพทย์ผู้ทำหัตถการ",
        "BegDT|วันเวลาเริ่ม",
        "EndDT|วันเวลาสิ้นสุด",
        "Ward|สถานที่/หอผู้ป่วย",
    ],
    "BillItems": [
        "Seq|ลำดับ",
        "SvDate|วันที่ให้บริการ",
        "BillMuad|หมวดค่ารักษา",
        "LCCode|รหัสรายการของ รพ.",
        "Desc|ชื่อรายการ",
        "QTY|จำนวน",
        "UnitPrice|ราคาต่อหน่วย",
        "ChargeAmt|รวมเป็นเงิน",
        "Copay|ส่วนที่ผู้ป่วยร่วมจ่าย",
        "ClaimAmt|จำนวนเงินที่ขอเบิก",
        "Reimburse|เบิกได้",
        "PayType|ประเภทการชำระ",
        "Note|หมายเหตุ",
        "TMT|รหัสยา TMT",
        "TMTNo|เลขที่ TMT",
        "Flag|สถานะรายการ",
        "Ref1|อ้างอิง 1",
        "Ref2|อ้างอิง 2",
    ],
}


def labels_for(section: str, width: int) -> List[str]:
    known = FIELD_LABELS.get(section, [])
    return [known[i] if i < len(known) else f"|ฟิลด์ {i + 1}" for i in range(width)]
