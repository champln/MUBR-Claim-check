"""
ยืนยันรหัสผ่านผู้ใช้ HOSxP แบบสด (live) กับฐาน HOSxP โดยตรง

HOSxP เก็บรหัสผ่านหลายรูปแบบตามเวอร์ชัน:
  - HOSxP XE / ใหม่ : คอลัมน์ `password` มักเป็น MD5 hex ของรหัสจริง
  - HOSxP MySQL เก่า: คอลัมน์ `passwd` เข้ารหัสด้วย ENCRYPT()/PASSWORD() ฝั่ง DB
รองรับได้หลายวิธี + auto-detect (ให้ admin กรอก user/รหัสจริง 1 ครั้ง แล้วหาว่าวิธีไหนตรง)
"""
from __future__ import annotations

import hashlib
from typing import Any, Optional

from sqlalchemy import create_engine, text

# วิธียืนยันที่รองรับ (เรียงตามลำดับที่ลอง detect)
AUTH_METHODS = ["MD5", "SHA1", "SHA256", "PLAIN", "MYSQL_PASSWORD", "MYSQL_ENCRYPT"]

# คอลัมน์รหัสผ่านที่พบบ่อยใน HOSxP (ใช้ตอน detect ถ้ายังไม่ระบุ)
PASSWORD_COLUMN_CANDIDATES = ["password", "passwd", "pass", "userpassword"]


class HosxpAuthError(Exception):
    pass


def _engine(db_url: str):
    return create_engine(db_url)


def _fetch_password(
    db_url: str, table: str, username_col: str, password_col: str, username: str
) -> Optional[str]:
    """ดึงค่ารหัสผ่านที่เก็บไว้ของ username นั้น"""
    sql = f"SELECT {password_col} AS pw FROM {table} WHERE {username_col} = :u LIMIT 1"
    try:
        with _engine(db_url).connect() as conn:
            row = conn.execute(text(sql), {"u": username}).mappings().first()
    except Exception as e:
        raise HosxpAuthError(f"อ่านรหัสผ่านจาก HOSxP ไม่สำเร็จ: {e}")
    if not row:
        return None
    pw = row.get("pw")
    return "" if pw is None else str(pw)


def _match_local(method: str, password: str, stored: str) -> bool:
    """เทียบฝั่ง Python (ไม่ต้องพึ่งฟังก์ชันของ DB)"""
    stored = (stored or "").strip()
    if not stored:
        return False
    if method == "PLAIN":
        return password == stored
    if method == "MD5":
        return hashlib.md5(password.encode("utf-8")).hexdigest().lower() == stored.lower()
    if method == "SHA1":
        return hashlib.sha1(password.encode("utf-8")).hexdigest().lower() == stored.lower()
    if method == "SHA256":
        return hashlib.sha256(password.encode("utf-8")).hexdigest().lower() == stored.lower()
    return False


def _match_db_side(db_url: str, method: str, password: str, stored: str) -> bool:
    """วิธีที่ต้องใช้ฟังก์ชันของ DB (MySQL เท่านั้น)"""
    try:
        with _engine(db_url).connect() as conn:
            if method == "MYSQL_PASSWORD":
                q = conn.execute(text("SELECT PASSWORD(:p) AS h"), {"p": password}).mappings().first()
                return bool(q) and str(q.get("h") or "") == stored
            if method == "MYSQL_ENCRYPT":
                q = conn.execute(
                    text("SELECT ENCRYPT(:p, :s) AS h"), {"p": password, "s": stored}
                ).mappings().first()
                return bool(q) and str(q.get("h") or "") == stored
    except Exception:
        return False
    return False


def verify_password(
    db_url: str,
    table: str,
    username_col: str,
    password_col: str,
    method: str,
    username: str,
    password: str,
) -> bool:
    """ยืนยันรหัสผ่านตามวิธีที่กำหนดไว้"""
    stored = _fetch_password(db_url, table, username_col, password_col, username)
    if stored is None:
        return False
    if method in ("MYSQL_PASSWORD", "MYSQL_ENCRYPT"):
        return _match_db_side(db_url, method, password, stored)
    return _match_local(method, password, stored)


def detect_auth(
    db_url: str,
    table: str,
    username_col: str,
    username: str,
    password: str,
    password_col: Optional[str] = None,
) -> dict[str, Optional[str]]:
    """
    ให้ admin กรอก user+รหัส HOSxP จริง 1 ครั้ง แล้วลองทุกวิธี/คอลัมน์
    คืน {password_column, auth_method} ที่ตรง หรือ raise ถ้าไม่เจอ
    """
    cols_to_try = [password_col] if password_col else PASSWORD_COLUMN_CANDIDATES

    # หาว่าตารางมีคอลัมน์อะไรบ้าง (ข้ามคอลัมน์ที่ไม่มี)
    from sqlalchemy import inspect
    try:
        existing = {c["name"] for c in inspect(_engine(db_url)).get_columns(table)}
    except Exception as e:
        raise HosxpAuthError(f"อ่านโครงสร้างตาราง {table} ไม่สำเร็จ: {e}")

    tried = []
    for col in cols_to_try:
        if col not in existing:
            continue
        stored = _fetch_password(db_url, table, username_col, col, username)
        if stored is None:
            raise HosxpAuthError(f"ไม่พบผู้ใช้ '{username}' ในตาราง {table}")
        for method in AUTH_METHODS:
            tried.append(f"{col}:{method}")
            ok = (
                _match_db_side(db_url, method, password, stored)
                if method in ("MYSQL_PASSWORD", "MYSQL_ENCRYPT")
                else _match_local(method, password, stored)
            )
            if ok:
                return {"password_column": col, "auth_method": method}

    raise HosxpAuthError(
        "ตรวจไม่พบวิธียืนยันรหัสที่ตรง — รหัสอาจผิด หรือ HOSxP ใช้การเข้ารหัสเฉพาะ "
        f"(ลองแล้ว: {', '.join(tried) or 'ไม่มีคอลัมน์รหัสผ่านที่รู้จัก'})"
    )
