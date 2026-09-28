"""
ลายเซ็นท้ายไฟล์ AIPN / CIPN (ผู้ป่วยใน)

แม้ attribute จะชื่อ HMAC แต่ของจริง "ไม่ได้ใช้คีย์" — ถอดสูตรได้จากโค้ดของโปรแกรม
สกส. เอง (SQL4DataAudit_Claim.SQL ใน RCM):

    _value = strextract(_data, [<CIPN>], [</CIPN>], 1, 4)   # เอาเฉพาะ <CIPN>...</CIPN>
    _value = _value + crlf                                   # ต่อท้ายด้วย CRLF
    _md5   = md5(_value)                                     # MD5 ธรรมดา
    <?EndNote HMAC="<_md5>"?>

ต่างจากแฟ้ม OPD ตรงที่ OPD เอา "ทุกไบต์ก่อน <?EndNote" ไปเข้า MD5 ส่วนผู้ป่วยใน
เอาเฉพาะช่วง <CIPN>...</CIPN> แล้วต่อ CRLF — ยืนยันกับไฟล์จริงของ รพ. แล้ว

ตั้งค่าใน backend/.env (ไฟล์นี้ไม่ขึ้น git):
    AIPN_HMAC_KEY=<คีย์ของโรงพยาบาล>
    AIPN_HMAC_ALGO=md5          # md5 (ค่าเริ่มต้น) | sha1 | sha256
    AIPN_HMAC_KEY_FORM=text     # text (ค่าเริ่มต้น) | hex | upper | lower
    AIPN_HMAC_SCOPE=head        # head (ทุกไบต์ก่อน <?EndNote) | head_rstrip | cipn
    AIPN_HMAC_MODE=hmac         # hmac (ค่าเริ่มต้น) | key_prefix | key_suffix
    AIPN_HMAC_ATTR=HMAC         # ชื่อ attribute ท้ายไฟล์

ยังไม่รู้สูตรที่ถูกต้อง? ใช้ tools/aipn_find_hmac.py หาสูตรจากไฟล์จริง
(รันในเครื่อง ไม่ต้องส่งคีย์ออกไปไหน) แล้วเอาผลลัพธ์มากรอกที่ตัวแปรข้างบน
"""
import binascii
import hashlib
import hmac
import os
import re
from typing import Optional

ENDNOTE_RE = re.compile(rb'<\?EndNote\s+([A-Za-z]+)="([0-9A-Fa-f]+)"\s*\?>')
_HASHES = {"md5": hashlib.md5, "sha1": hashlib.sha1, "sha256": hashlib.sha256}


def _cfg(name: str, default: str = "") -> str:
    return (os.getenv(name) or default).strip()


# โหมด "plain" = MD5 ธรรมดาแบบแฟ้มผู้ป่วยนอก (ไม่ใช้คีย์)
# ⚠ ทดลองเท่านั้น: ตรวจกับไฟล์จริงแล้วค่าไม่ตรงกับลายเซ็นที่โปรแกรม สกส. สร้าง
PLAIN_MODE = "plain"


def is_configured(mode: str = "") -> bool:
    """เซ็นได้เสมอ — สูตรมาตรฐานไม่ต้องใช้คีย์"""
    return True


def has_key() -> bool:
    return bool(_cfg("AIPN_HMAC_KEY"))


def config_summary() -> dict:
    """สรุปการตั้งค่า (ไม่เปิดเผยคีย์)"""
    key = _cfg("AIPN_HMAC_KEY")
    return {
        "configured": True,
        "has_key": bool(key),
        "key_length": len(key),
        "algo": _cfg("AIPN_HMAC_ALGO", "md5"),
        "formula": "MD5(<CIPN>...</CIPN> + CRLF)" if _cfg("AIPN_HMAC_MODE", "cipn").lower() in ("cipn", "cipn_md5") else "custom",
        "key_form": _cfg("AIPN_HMAC_KEY_FORM", "text"),
        "scope": _cfg("AIPN_HMAC_SCOPE", "head"),
        "mode": _cfg("AIPN_HMAC_MODE", "cipn"),
        "attr": _cfg("AIPN_HMAC_ATTR", "HMAC"),
    }


def _key_bytes() -> bytes:
    key = _cfg("AIPN_HMAC_KEY")
    form = _cfg("AIPN_HMAC_KEY_FORM", "text").lower()
    if form == "hex":
        try:
            return binascii.unhexlify(key)
        except Exception as e:
            raise ValueError(f"AIPN_HMAC_KEY ไม่ใช่ hex ที่ถูกต้อง: {e}")
    if form == "upper":
        return key.upper().encode("utf-8")
    if form == "lower":
        return key.lower().encode("utf-8")
    return key.encode("utf-8")


def _body(head: bytes) -> bytes:
    scope = _cfg("AIPN_HMAC_SCOPE", "head").lower()
    if scope == "head_rstrip":
        return head.rstrip(b"\r\n")
    if scope == "cipn":
        m = re.search(rb"<CIPN>.*</CIPN>", head, re.S)
        if not m:
            raise ValueError("หา <CIPN>...</CIPN> ในไฟล์ไม่พบ")
        return m.group(0)
    return head


CIPN_RE = re.compile(rb"<CIPN>.*</CIPN>", re.S)
CRLF = b"\r\n"


def compute_cipn_md5(head: bytes) -> str:
    """สูตรจริงของไฟล์ผู้ป่วยใน: MD5 ของ <CIPN>...</CIPN> + CRLF (ไม่ใช้คีย์)"""
    m = CIPN_RE.search(head)
    if not m:
        raise ValueError("ไม่พบ <CIPN>...</CIPN> ในไฟล์ จึงคำนวณลายเซ็นไม่ได้")
    return hashlib.md5(m.group(0) + CRLF).hexdigest().upper()


def compute(head: bytes, mode_override: str = "") -> str:
    """คำนวณลายเซ็นของเนื้อไฟล์ (ตัวพิมพ์ใหญ่) ตามการตั้งค่า"""
    mode = (mode_override or _cfg("AIPN_HMAC_MODE", "cipn")).lower()
    # ค่าเริ่มต้น = สูตรจริงของ สกส. (ไม่ใช้คีย์)
    if mode in ("cipn", "cipn_md5"):
        return compute_cipn_md5(head)
    if mode == PLAIN_MODE:
        algo = _cfg("AIPN_HMAC_ALGO", "md5").lower()
        return _HASHES.get(algo, hashlib.md5)(_body(head)).hexdigest().upper()
    if not is_configured(mode):
        raise ValueError(
            "ยังไม่ได้ตั้งค่าคีย์สำหรับเซ็นไฟล์ผู้ป่วยใน (AIPN/CIPN) — "
            "ไฟล์ผู้ป่วยในเซ็นด้วย HMAC ที่ต้องใช้คีย์ของโรงพยาบาลจากระบบ AIPN ของ สกส. "
            "กรุณาตั้งค่า AIPN_HMAC_KEY ใน backend/.env ก่อน"
        )
    algo = _cfg("AIPN_HMAC_ALGO", "md5").lower()
    if algo not in _HASHES:
        raise ValueError(f"AIPN_HMAC_ALGO ต้องเป็น md5/sha1/sha256 (ได้ '{algo}')")
    hfunc = _HASHES[algo]
    key, body = _key_bytes(), _body(head)

    if mode == "key_prefix":
        return hfunc(key + body).hexdigest().upper()
    if mode == "key_suffix":
        return hfunc(body + key).hexdigest().upper()
    return hmac.new(key, body, hfunc).hexdigest().upper()


def sign_endnote(head: bytes, mode_override: str = "") -> str:
    """
    สร้างบรรทัด <?EndNote ...?> ใหม่สำหรับไฟล์ที่แก้แล้ว
    เว้นวรรคก่อน ?> ให้เหมือนไฟล์ที่โปรแกรม สกส. สร้าง
    """
    attr = _cfg("AIPN_HMAC_ATTR", "HMAC")
    return f'<?EndNote {attr}="{compute(head, mode_override)}" ?>'


def verify(raw: bytes) -> Optional[bool]:
    """
    ตรวจว่าลายเซ็นในไฟล์ตรงกับที่คำนวณได้ไหม
    None = ยังไม่ได้ตั้งค่าคีย์ หรือไฟล์ไม่มีลายเซ็น
    """
    m = ENDNOTE_RE.search(raw)
    if not m:
        return None
    stored = m.group(2).decode("ascii").upper()
    try:
        return compute(raw[: m.start()]) == stored
    except ValueError:
        return None
