"""
บันทึกประวัติการแก้ไฟล์ส่งเบิกของทุกเมนู แล้วส่งไฟล์กลับให้ผู้ใช้ในคราวเดียว

ใช้แทน StreamingResponse ในเมนูแก้ไฟล์ — อาร์กิวเมนต์เหมือนกันทุกตัว:
    return record_fix(db, current_user, "svdate", io.BytesIO(data), media_type=..., headers=headers)

ชื่อไฟล์และรายการที่แก้อ่านจาก header ที่เมนูตั้งไว้อยู่แล้ว (X-Filename / X-Fix-Changes ...)
ส่วนชื่อประวัติ ปีงบ และวันรับบริการ อ่านจากเนื้อไฟล์ (BILLTRAN หรือ CIPN/AIPN)
"""
import io
import json
import logging
import re
import zipfile
from typing import Dict, List, Optional

from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from models import FixHistory, User
from services.csop_file_editor import ENCODING, CsopFile, thai_fiscal_year

log = logging.getLogger(__name__)

# ชื่อเมนูที่แสดงในประวัติรวม
MENU_LABELS: Dict[str, str] = {
    "stdcode": "รหัสหัตถการ (S19/S41)",
    "opd-fee": "ยอดค่าบริการ (A04/T33/45)",
    "svdate": "วันที่ให้บริการ (T42)",
    "sig": "วิธีการใช้ยา (R24)",
    "claimcont": "เหตุผลการใช้ยา (G04)",
    "tmt": "รหัส TMT ยา",
    "rama-sh50": "ปกส.รามา SH50",
    "covid19": "COVID-19",
    "cipn-fix": "ClaimCat ยอดรวม AuthCode (ผู้ป่วยใน)",
    "cipn-daterev": "DateRev และค่า HMAC (ผู้ป่วยใน)",
}

_CHANGE_HEADERS = ("X-Fix-Changes", "X-Changes", "X-Removed", "X-Auth")


def _filename(headers: Dict[str, str]) -> str:
    name = headers.get("X-Filename") or headers.get("X-Zip-Filename") or ""
    if not name:
        m = re.search(r"filename=([^;]+)", headers.get("Content-Disposition", ""))
        name = m.group(1).strip('" ') if m else "fixed"
    return name


def _changes(headers: Dict[str, str]) -> List:
    out: List = []
    for h in _CHANGE_HEADERS:
        raw = headers.get(h)
        if not raw:
            continue
        try:
            val = json.loads(raw)
        except Exception:
            continue
        if not val:
            continue
        if h == "X-Fix-Changes":
            out.extend(val if isinstance(val, list) else [val])
        elif h == "X-Changes":
            out.extend(f"แถว {c.get('seq')}: ClaimCat {c.get('before', {}).get('claim_cat')} → "
                       f"{c.get('after', {}).get('claim_cat')}" for c in val if isinstance(c, dict))
        elif h == "X-Removed":
            out.extend(f"ลบแถว {r.get('seq')} {r.get('desc', '')} ({r.get('charge_amt', '')})"
                       for r in val if isinstance(r, dict))
        elif h == "X-Auth" and isinstance(val, dict):
            out.append(f"AuthCode {val.get('before', {}).get('auth_code') or '(ว่าง)'} → "
                       f"{val.get('after', {}).get('auth_code')}")
    return out


def _describe(data: bytes, filename: str) -> dict:
    """ดึงชื่อประวัติ / วันรับบริการ / ปีงบ จากเนื้อไฟล์ (อ่านไม่ได้ก็คืนค่าว่าง ไม่ทำให้การแก้ล้ม)"""
    info = {"session_name": filename, "service_date": "", "fiscal_year": None, "pay_plan": ""}
    files: Dict[str, bytes] = {}
    if data[:2] == b"PK":
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            files = {n.split("/")[-1]: zf.read(n) for n in zf.namelist()}
    else:
        files = {filename: data}

    # ผู้ป่วยใน: CIPN / AIPN
    for name, raw in files.items():
        if b"<CIPN" in raw or b"<AIPN" in raw:
            text = raw.decode(ENCODING, "replace")
            doc = (re.search(r"<DocSysID[^>]*>([^<]*)</DocSysID>", text) or [None, "CIPN"])[1]
            m = re.search(r"<IPADT>\s*\r?\n([^\r\n]+)", text)
            f = m.group(1).split("|") if m else []
            an = f[0].strip() if f else ""
            dsc = f[15][:10] if len(f) > 15 else ""
            info.update(session_name=f"{doc} AN {an}".strip(), service_date=dsc,
                        fiscal_year=thai_fiscal_year(dsc) if dsc else None)
            return info

    # ผู้ป่วยนอก: อ่านจาก BILLTRAN
    bt_name = next((n for n in files if "BILLTRAN" in n.upper()), None)
    if bt_name:
        bt = CsopFile.parse(files[bt_name])
        sess = (re.search(r"<SESSNO>([^<]*)</SESSNO>", bt.head_text) or [None, ""])[1].strip()
        svd = ""
        for row in bt.section_rows("BILLTRAN"):
            if len(row) > 2 and re.match(r"\d{4}-\d{2}-\d{2}", row[2].strip()):
                svd = row[2].strip()[:10]
                break
        label = f"{bt.pay_plan}{bt.system} {sess}".strip() if sess else filename
        info.update(session_name=f"{label} · {svd}".strip(" ·"), service_date=svd,
                    fiscal_year=thai_fiscal_year(svd) if svd else None, pay_plan=bt.pay_plan)
    return info


def record_fix(db: Session, user: Optional[User], menu: str, stream: io.BytesIO,
               media_type: str = "application/octet-stream",
               headers: Optional[Dict[str, str]] = None) -> StreamingResponse:
    """บันทึกไฟล์ผลลัพธ์ลงประวัติ แล้วคืน StreamingResponse ตัวเดิมให้ผู้ใช้ดาวน์โหลด"""
    headers = dict(headers or {})
    data = stream.getvalue()
    filename = _filename(headers)
    try:
        info = _describe(data, filename)
        row = FixHistory(
            menu=menu,
            session_name=info["session_name"][:255],
            fiscal_year=info["fiscal_year"],
            service_date=info["service_date"],
            pay_plan=info["pay_plan"],
            changes=json.dumps(_changes(headers), ensure_ascii=False),
            result_blob=data,
            result_filename=filename,
            media_type=media_type,
            size_bytes=len(data),
            created_by_id=getattr(user, "id", None),
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        headers["X-History-Id"] = str(row.id)
        expose = headers.get("Access-Control-Expose-Headers", "")
        headers["Access-Control-Expose-Headers"] = ", ".join(x for x in (expose, "X-History-Id") if x)
    except Exception:
        # บันทึกประวัติไม่ได้ ก็ยังต้องให้ผู้ใช้ได้ไฟล์ที่แก้แล้ว
        db.rollback()
        log.exception("บันทึกประวัติการแก้ไฟล์ไม่สำเร็จ (menu=%s)", menu)
    return StreamingResponse(io.BytesIO(data), media_type=media_type, headers=headers)
