"""
อ่าน/แก้ไขไฟล์ส่งเบิกระดับ "ฟิลด์" แบบรักษาไบต์เดิม แล้วเซ็น Checksum (MD5) ใหม่

ใช้กับหน้า "ตรวจไฟล์ส่งเบิก" เพื่อให้คลิกแก้ได้ทุกฟิลด์ในทุกแฟ้ม/ทุก section
โดยไม่ต้องรู้ว่าเป็นเคสไหน — ต่างจากเมนูแก้เฉพาะเคสที่แก้ให้อัตโนมัติตามกฎ

ชื่อฟิลด์: ที่รู้แน่ (จากไฟล์จริง + สเปก) จะใส่ชื่อไทยให้ ที่ยังไม่ยืนยัน
จะแสดงเป็น "ฟิลด์ N" ตรงๆ ดีกว่าเดาชื่อผิดแล้วทำให้แก้ผิดช่อง
"""
from typing import Dict, List, Optional

from services.csop_file_editor import CsopFile, split_endnote, verify_checksum

# section ที่รองรับ เรียงตามลำดับที่อยากให้แสดง
SECTIONS_BY_FILE = {
    "BILLTRAN": ["BILLTRAN", "BillItems"],
    "BILLDISP": ["Dispensing", "DispensedItems"],
    "OPSERVICES": ["OPServices", "OPDx"],
}

# ชื่อฟิลด์ที่ยืนยันแล้ว: {section: {index: ชื่อ}}
FIELD_LABELS: Dict[str, Dict[int, str]] = {
    "BILLTRAN": {
        1: "รหัสอนุมัติ (AuthCode)",
        2: "วันเวลารับบริการ",
        3: "รหัสสถานพยาบาล",
        4: "Inv.no",
        6: "HN",
        8: "ยอดรวม",
        13: "ชื่อ-สกุลผู้ป่วย",
        14: "รหัส รพ.หลัก (HMain)",
        16: "ยอดขอเบิก",
        17: "ผู้ร่วมจ่าย (OtherPayplan)",
        18: "ยอดผู้ร่วมจ่าย",
    },
    "BillItems": {
        0: "Inv.no",
        1: "วันที่ให้บริการ",
        2: "หมวด (BillMu)",
        3: "รหัสรายการ รพ.",
        4: "รหัสมาตรฐาน / TMT",
        5: "ชื่อรายการ",
        6: "จำนวน",
        7: "ราคาต่อหน่วย",
        8: "รวมเป็นเงิน",
        9: "จำนวนเงินที่เบิกได้",
        10: "จำนวนเงินที่ขอเบิก",
        11: "SvPID",
        12: "Ward",
    },
    "OPServices": {
        0: "Inv.no",
        1: "รหัสรายการ (ItemID)",
        2: "ประเภท (Class)",
        3: "รหัสสถานพยาบาล",
        4: "HN",
        5: "เลขบัตรประชาชน",
        11: "เลขใบประกอบวิชาชีพ",
        13: "วันเวลาเริ่ม",
        14: "วันเวลาสิ้นสุด",
        15: "รหัสบริการ รพ. (LocalCode)",
        16: "ประเภทรหัส",
        17: "รหัสหัตถการ (STDCode)",
        18: "จำนวนเงิน",
        19: "สถานะใช้สิทธิ์",
        20: "SvPID",
        21: "Ward",
    },
    "OPDx": {
        0: "ประเภท (Class)",
        1: "อ้างอิง visit",
        2: "ลำดับ/ชนิดการวินิจฉัย",
        3: "ประเภทรหัสโรค",
        4: "รหัสโรค (ICD-10)",
    },
    "Dispensing": {
        0: "รหัสสถานพยาบาล",
        2: "Inv.no",
        4: "เลขบัตรประชาชน",
        5: "วันเวลารับบริการ",
        6: "วันเวลาจ่ายยา",
        9: "ยอดรวม",
        10: "ยอดขอเบิก",
        14: "สิทธิ์ (PayPlan)",
    },
    "DispensedItems": {
        2: "รหัสยา รพ. (Hosdrugcode)",
        3: "รหัส TMT",
        5: "ชื่อยา",
        6: "หน่วย",
        9: "จำนวน",
        10: "ราคาต่อหน่วย",
        11: "รวมเป็นเงิน",
        12: "จำนวนเงินที่เบิกได้",
        13: "จำนวนเงินที่ขอเบิก",
    },
}


def _labels_for(section: str, width: int) -> List[str]:
    known = FIELD_LABELS.get(section, {})
    return [known.get(i, f"ฟิลด์ {i + 1}") for i in range(width)]


def _sections_for(filename: str) -> List[str]:
    up = filename.upper()
    for key, sections in SECTIONS_BY_FILE.items():
        if key in up:
            return sections
    return []


def editability(raw: bytes) -> tuple:
    """
    (แก้ได้ไหม, เหตุผล) — แก้ได้เฉพาะไฟล์ที่เซ็นด้วย MD5 และลายเซ็นเดิมถูกต้อง
    AIPN เซ็นด้วย HMAC ที่ไม่มีกุญแจ (<?EndNote HMAC="...">) จึงเซ็นใหม่ไม่ได้
    ไฟล์ที่ checksum เดิมไม่ตรงก็ไม่แก้ให้ เพราะอาจเสียหาย/ถูกแก้มาแล้ว
    """
    try:
        _, endnote = split_endnote(raw)
    except Exception as e:
        return False, f"อ่านไฟล์ไม่สำเร็จ: {e}"
    if endnote is None:
        return False, "ไฟล์นี้ไม่มีลายเซ็นท้ายไฟล์ (<?EndNote) จึงไม่รองรับการแก้"
    ok = verify_checksum(raw)
    if ok is None:
        return False, "ไฟล์นี้ไม่ได้เซ็นด้วย MD5 (เช่น AIPN ใช้ HMAC ที่ไม่มีกุญแจ) จึงเซ็นใหม่ไม่ได้"
    if ok is False:
        return False, "Checksum เดิมของไฟล์ไม่ถูกต้อง — ตรวจไฟล์ต้นทางก่อน ระบบจะไม่แก้ทับให้"
    return True, ""


def is_editable(raw: bytes) -> bool:
    return editability(raw)[0]


def read_sections(files: Dict[str, bytes]) -> List[dict]:
    """อ่านทุกไฟล์ในชุด -> โครงสร้างสำหรับแสดงเป็นตารางที่แก้ได้"""
    out: List[dict] = []
    for name in sorted(files):
        raw = files[name]
        editable, reason = editability(raw)
        entry = {
            "file": name,
            "editable": editable,
            "checksum_ok": verify_checksum(raw),
            "reason": reason,
            "sections": [],
        }
        if editable:
            try:
                cf = CsopFile.parse(raw)
            except Exception as e:
                entry["editable"] = False
                entry["reason"] = f"อ่านไฟล์ไม่สำเร็จ: {e}"
                out.append(entry)
                continue
            for tag in _sections_for(name):
                rows = cf.section_rows(tag)
                if not rows:
                    continue
                width = max(len(r) for r in rows)
                entry["sections"].append({
                    "section": tag,
                    "labels": _labels_for(tag, width),
                    "rows": [r + [""] * (width - len(r)) for r in rows],
                })
        out.append(entry)
    return out


def apply_edits(files: Dict[str, bytes], edits: List[dict]) -> Dict[str, bytes]:
    """
    ใช้รายการแก้ไข {file, section, row, field, value} กับไฟล์ต้นฉบับ
    แล้วเซ็น Checksum ใหม่เฉพาะไฟล์ที่ถูกแตะ (ไฟล์อื่นคงเดิมทุกไบต์)
    """
    by_file: Dict[str, List[dict]] = {}
    for e in edits:
        by_file.setdefault(str(e.get("file", "")), []).append(e)

    out: Dict[str, bytes] = dict(files)
    for fname, file_edits in by_file.items():
        if fname not in files:
            raise ValueError(f"ไม่พบไฟล์ '{fname}' ในชุดที่บันทึกไว้")
        if not is_editable(files[fname]):
            raise ValueError(f"ไฟล์ '{fname}' แก้ไม่ได้ (ไม่ได้เซ็นด้วย MD5)")

        cf = CsopFile.parse(files[fname])
        by_section: Dict[str, List[dict]] = {}
        for e in file_edits:
            by_section.setdefault(str(e.get("section", "")), []).append(e)

        for section, sec_edits in by_section.items():
            # {row_index: {field_index: value}}
            wanted: Dict[int, Dict[int, str]] = {}
            for e in sec_edits:
                try:
                    r, f = int(e["row"]), int(e["field"])
                except (KeyError, TypeError, ValueError):
                    raise ValueError("รายการแก้ไขต้องมี row และ field เป็นตัวเลข")
                if r < 0 or f < 0:
                    raise ValueError("row/field ต้องไม่ติดลบ")
                wanted.setdefault(r, {})[f] = str(e.get("value", ""))

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
                        raise ValueError(
                            f"{fname}/{section} แถว {counter['i'] + 1}: ไม่มีฟิลด์ที่ {f_idx + 1}"
                        )
                    new[f_idx] = value
                applied.add(counter["i"])
                return new

            changed_rows = cf.edit_section(section, fix)
            missing = set(wanted) - applied
            if missing:
                raise ValueError(
                    f"{fname}/{section}: ไม่พบแถวที่ {sorted(m + 1 for m in missing)} "
                    "(ไฟล์อาจถูกแก้จากที่อื่นแล้ว)"
                )
            del changed_rows

        out[fname] = cf.to_bytes()
    return out
