"""
engine กลางสำหรับเชื่อมฐาน HOSxP — ใช้ร่วมกันทุกที่ (Pre-screen สด / ล็อกอิน HOSxP / ค้นหาผู้ใช้)

เดิมแต่ละครั้งที่เรียกจะสร้าง engine ใหม่ (พร้อม connection pool ของตัวเอง) แล้วไม่ปิด
ทำให้ connection ค้างสะสมจนชนเพดานของ user ฐานข้อมูล ("too many connections for role")
ที่นี่จึงเก็บ engine ไว้ 1 ตัวต่อ URL และจำกัด pool ให้เล็ก

ปิดเมื่อว่างนาน: connection ของ user ใน HOSXP_IDLE_CLOSE_USERS (ค่าเริ่มต้น claim_check)
ที่ไม่มีใครใช้เกิน HOSXP_IDLE_CLOSE_SECONDS (ค่าเริ่มต้น 300 วินาที) จะถูกปิดคืนฐาน HOSxP
ช่วงที่มีคนใช้ (เช่นเปิด Pre-screen สดรีเฟรชทุก 1 นาที) ยังใช้ connection เดิมต่อเนื่อง
"""
import logging
import os
import threading
import time
from typing import Dict

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine

# รวมสูงสุด 4 connection ต่อ URL — user อ่านอย่างเดียวของ รพ. จำกัดไว้ 10
POOL_SIZE = 2
MAX_OVERFLOW = 2

IDLE_CLOSE_SECONDS = int(os.getenv("HOSXP_IDLE_CLOSE_SECONDS", "300"))
IDLE_CLOSE_USERS = {u.strip().lower() for u in os.getenv("HOSXP_IDLE_CLOSE_USERS", "claim_check").split(",") if u.strip()}
_REAPER_INTERVAL = 60

log = logging.getLogger(__name__)

_engines: Dict[str, Engine] = {}
_last_used: Dict[str, float] = {}
_lock = threading.Lock()
_reaper_started = False


def _touch(db_url: str) -> None:
    _last_used[db_url] = time.monotonic()


def _close_idle_once() -> int:
    """ปิด connection ที่ว่างอยู่ใน pool ของ user ที่กำหนด เมื่อไม่มีใครใช้เกินเวลาที่ตั้ง — คืนจำนวนที่ปิด"""
    closed = 0
    now = time.monotonic()
    with _lock:
        items = list(_engines.items())
    for db_url, eng in items:
        if (eng.url.username or "").lower() not in IDLE_CLOSE_USERS:
            continue
        pool = eng.pool
        try:
            idle_conns = pool.checkedin()
            busy = pool.checkedout()
        except Exception:
            continue
        if idle_conns == 0 or busy > 0:
            continue
        if now - _last_used.get(db_url, now) < IDLE_CLOSE_SECONDS:
            continue
        # dispose ปิดเฉพาะ connection ที่คืนเข้า pool แล้ว engine ยังใช้ต่อได้ (เปิดใหม่เมื่อมีคนเรียก)
        eng.dispose()
        closed += idle_conns
        log.info("closed %d idle HOSxP connection(s) for %s", idle_conns, eng.url.username)
    return closed


def _reaper() -> None:
    while True:
        time.sleep(_REAPER_INTERVAL)
        try:
            _close_idle_once()
        except Exception:  # ห้ามให้ thread ตาย
            log.exception("idle connection reaper failed")


def _start_reaper() -> None:
    global _reaper_started
    if _reaper_started or not IDLE_CLOSE_USERS or IDLE_CLOSE_SECONDS <= 0:
        return
    _reaper_started = True
    threading.Thread(target=_reaper, name="hosxp-idle-reaper", daemon=True).start()


def get_engine(db_url: str) -> Engine:
    with _lock:
        eng = _engines.get(db_url)
        if eng is None:
            # เปลี่ยนการตั้งค่าเชื่อมต่อ (URL ใหม่) -> ปิด engine เก่าทิ้ง ไม่ให้ connection ค้าง
            for old in _engines.values():
                old.dispose()
            _engines.clear()
            _last_used.clear()
            eng = create_engine(
                db_url,
                pool_size=POOL_SIZE,
                max_overflow=MAX_OVERFLOW,
                pool_pre_ping=True,     # กัน connection ตายเมื่อ HOSxP รีสตาร์ท
                pool_recycle=300,       # คืน connection ที่ค้างนานให้ฐาน HOSxP
                pool_timeout=15,
            )
            # จดเวลาที่ใช้ล่าสุด (หยิบ/คืน connection) ไว้ตัดสินว่าว่างนานหรือยัง
            event.listen(eng, "checkout", lambda *_a, u=db_url: _touch(u))
            event.listen(eng, "checkin", lambda *_a, u=db_url: _touch(u))
            _engines[db_url] = eng
            _touch(db_url)
        _start_reaper()
        return eng
