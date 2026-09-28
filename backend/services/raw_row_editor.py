"""
อ่าน/แก้ไขไฟล์ส่งเบิกระดับ "ฟิลด์" แบบรักษาไบต์เดิม แล้วเซ็น Checksum (MD5) ใหม่

ใช้กับหน้า "ตรวจไฟล์ส่งเบิก" เพื่อให้คลิกแก้ได้ทุกฟิลด์ในทุกแฟ้ม/ทุก section
โดยไม่ต้องรู้ว่าเป็นเคสไหน — ต่างจากเมนูแก้เฉพาะเคสที่แก้ให้อัตโนมัติตามกฎ

ชื่อฟิลด์: ที่รู้แน่ (จากไฟล์จริง + สเปก) จะใส่ชื่อไทยให้ ที่ยังไม่ยืนยัน
จะแสดงเป็น "ฟิลด์ N" ตรงๆ ดีกว่าเดาชื่อผิดแล้วทำให้แก้ผิดช่อง
"""
from typing import Dict, List, Optional

from services.aipn_signer import config_summary as aipn_config
from services.aipn_signer import verify as aipn_verify
from services.cipn_file_editor import apply_cipn_edits, is_cipn, read_cipn
from services.csop_file_editor import CsopFile, split_endnote, verify_checksum

# section ที่รองรับ เรียงตามลำดับที่อยากให้แสดง
SECTIONS_BY_FILE = {
    "BILLTRAN": ["BILLTRAN", "BillItems"],
    "BILLDISP": ["Dispensing", "DispensedItems"],
    "OPSERVICES": ["OPServices", "OPDx"],
}

# ชื่อฟิลด์ตามโครงสร้างไฟล์ สกส. (CHI OP v0.93) — "ชื่อตามสเปก|ความหมายภาษาไทย"
# ตรวจลำดับกับไฟล์จริงของ รพ. แล้วทุก section (จำนวนฟิลด์ตรงกันทุกแฟ้ม)
FIELD_LABELS: Dict[str, List[str]] = {
    "BILLTRAN": [
        "Station|รหัสประเภทแฟ้ม (21=ข้าราชการ, 02=ประกันสังคม)",
        "AuthCode|รหัสอนุมัติ",
        "DTTran|วันเวลาที่รับบริการ",
        "HCode|รหัสสถานพยาบาล",
        "InvNo|เลขที่ใบแจ้งหนี้ (Inv.no)",
        "BillNo|เลขที่ใบเสร็จ",
        "HN|เลขประจำตัวผู้ป่วย (HN)",
        "MemberNo|เลขที่สมาชิก",
        "Amount|ยอดเงินรวม",
        "Paid|ยอดที่ผู้ป่วยชำระเอง",
        "VerCode|รหัสยืนยันสิทธิ",
        "Tflag|สถานะรายการ (A=เพิ่ม E=แก้ D=ลบ)",
        "Pid|เลขบัตรประชาชน",
        "Name|ชื่อ-สกุลผู้ป่วย",
        "HMain|รหัส รพ.หลัก",
        "PayPlan|รหัสสิทธิการรักษา",
        "ClaimAmt|ยอดขอเบิก",
        "OtherPayplan|สิทธิผู้ร่วมจ่าย",
        "OtherPay|ยอดผู้ร่วมจ่าย",
    ],
    "BillItems": [
        "InvNo|เลขที่ใบแจ้งหนี้ (Inv.no)",
        "SvDate|วันที่ให้บริการ",
        "BillMuad|หมวดค่ารักษา",
        "LCCode|รหัสรายการของ รพ.",
        "STDCode|รหัสมาตรฐาน / TMT",
        "Desc|ชื่อรายการ",
        "QTY|จำนวน",
        "UnitPrice|ราคาต่อหน่วย",
        "ChargeAmt|รวมเป็นเงิน",
        "ClaimUP|ราคาเบิกได้ต่อหน่วย",
        "ClaimAmount|จำนวนเงินที่ขอเบิก",
        "SvRefID|รหัสอ้างอิงการให้บริการ",
        "ClaimCat|ประเภทการเบิก",
    ],
    "OPServices": [
        "Invno|เลขที่ใบแจ้งหนี้ (Inv.no)",
        "SvID|รหัสการให้บริการ (VN)",
        "Class|ประเภท (EC=visit, OP=หัตถการ)",
        "Hcode|รหัสสถานพยาบาล",
        "HN|เลขประจำตัวผู้ป่วย (HN)",
        "PID|เลขบัตรประชาชน",
        "CareAccount|ลำดับบัญชีการดูแล",
        "TypeServ|ประเภทการให้บริการ",
        "TypeIn|ประเภทการมารับบริการ",
        "TypeOut|ประเภทการจำหน่าย",
        "DTAppoint|วันนัดครั้งต่อไป",
        "SvPID|เลขใบประกอบวิชาชีพผู้ให้บริการ",
        "Clinic|รหัสคลินิก",
        "BegDT|วันเวลาเริ่มบริการ",
        "EndDT|วันเวลาสิ้นสุดบริการ",
        "LcCode|รหัสบริการของ รพ.",
        "CodeSet|ชุดรหัส",
        "STDCode|รหัสหัตถการมาตรฐาน",
        "SvCharge|ค่าบริการ",
        "Completion|สถานะเสร็จสิ้น (Y/N)",
        "SvTxCode|รหัสผลการให้บริการ",
        "ClaimCat|ประเภทการเบิก",
    ],
    "OPDx": [
        "Class|ประเภท (EC=visit)",
        "SvID|รหัสการให้บริการ (VN)",
        "SL|ลำดับการวินิจฉัย (1=โรคหลัก)",
        "CodeSet|ชุดรหัสโรค (IT=ICD-10-TM)",
        "Code|รหัสโรค",
        "Desc|คำอธิบายโรค",
    ],
    "Dispensing": [
        "ProviderID|รหัสสถานพยาบาล",
        "DispID|เลขที่ใบสั่งยา",
        "Invno|เลขที่ใบแจ้งหนี้ (Inv.no)",
        "HN|เลขประจำตัวผู้ป่วย (HN)",
        "PID|เลขบัตรประชาชน",
        "Prescdt|วันเวลาสั่งยา",
        "Dispdt|วันเวลาจ่ายยา",
        "Prescb|ผู้สั่งยา (เลขใบประกอบวิชาชีพ)",
        "Itemcnt|จำนวนรายการยา",
        "ChargeAmt|ยอดรวม",
        "ClaimAmt|ยอดขอเบิก",
        "Paid|ยอดที่ผู้ป่วยชำระเอง",
        "OtherPay|ยอดผู้ร่วมจ่าย",
        "Reimburser|หน่วยงานผู้จ่ายชดเชย",
        "BenefitPlan|สิทธิการรักษา",
        "DispeStat|สถานะการจ่ายยา",
        "SvID|รหัสการให้บริการ (VN)",
        "DayCover|จำนวนวันที่ใช้ยา",
    ],
    "DispensedItems": [
        "DispID|เลขที่ใบสั่งยา",
        "PrdCat|ประเภทผลิตภัณฑ์",
        "HospDrgID|รหัสยาของ รพ. (Hosdrugcode)",
        "DrgID|รหัสยา TMT",
        "dfsCode|รหัสรูปแบบยา",
        "dfsText|ชื่อยา",
        "Packsize|หน่วยบรรจุ",
        "sigCode|รหัสวิธีใช้ยา",
        "sigText|วิธีใช้ยา",
        "Quantity|จำนวน",
        "UnitPrice|ราคาต่อหน่วย",
        "ChargeAmt|รวมเป็นเงิน",
        "ReimbPrice|ราคาเบิกได้ต่อหน่วย",
        "ReimbAmt|จำนวนเงินที่ขอเบิก",
        "PrdSeCode|รหัสผลิตภัณฑ์/ล็อต",
        "Claimcont|เงื่อนไขการเบิก (เช่น EB)",
        "ClaimCat|ประเภทการเบิก",
        "MultiDisp|การจ่ายยาหลายครั้ง",
        "SupplyFor|จ่ายยาสำหรับ",
    ],
}


def _labels_for(section: str, width: int) -> List[str]:
    known = FIELD_LABELS.get(section, [])
    return [known[i] if i < len(known) else f"|ฟิลด์ {i + 1}" for i in range(width)]


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
        if is_cipn(raw):
            if aipn_config()["has_key"] and aipn_verify(raw) is False:
                return False, (
                    "ตั้งค่าคีย์ HMAC ไว้แล้ว แต่คำนวณลายเซ็นของไฟล์นี้ไม่ตรงกับที่อยู่ในไฟล์ — "
                    "สูตรหรือคีย์ยังไม่ถูกต้อง (ตรวจด้วย tools/aipn_find_hmac.py) ระบบจะไม่เซ็นทับให้"
                )
            return True, ""
        return False, "ไฟล์นี้ไม่ได้เซ็นด้วย MD5 จึงเซ็นใหม่ไม่ได้"
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
            "kind": "CHI",
            "sections": [],
        }
        if is_cipn(raw):
            # อ่าน/ดูได้เสมอ ส่วนจะ "แก้แล้วเซ็นกลับ" ได้ไหม ขึ้นกับว่าตั้งค่าคีย์ไว้หรือยัง
            entry["kind"] = "CIPN"
            try:
                entry["sections"] = read_cipn(raw)["sections"]
            except Exception as e:
                entry["editable"] = False
                entry["reason"] = f"อ่านไฟล์ไม่สำเร็จ: {e}"
            out.append(entry)
            continue

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
                    "readonly_fields": [],
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
        ok, reason = editability(files[fname])
        if not ok:
            raise ValueError(f"ไฟล์ '{fname}' แก้ไม่ได้ — {reason}")

        if is_cipn(files[fname]):
            out[fname] = apply_cipn_edits(files[fname], file_edits)
            continue

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
