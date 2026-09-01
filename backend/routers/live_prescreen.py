"""
Pre-screen สด (กึ่ง real-time) — ดึง visit จากฐาน HOSxP โดยตรงแล้วรันกฎตรวจสอบทันที
ไม่บันทึกผลลง DB (ephemeral) — frontend จะ poll ซ้ำตามรอบเวลาที่ผู้ใช้ตั้ง
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from models import HosxpConnectionConfig, User, ValidationRule
from services.claim_checker import run_prescreen
from services.hosxp_live_source import (
    HosxpLiveSourceError,
    fetch_live_opd_records,
    test_connection,
)

router = APIRouter(prefix="/live-prescreen", tags=["live-prescreen"])


def _get_db_url(db: Session) -> Optional[str]:
    cfg = db.query(HosxpConnectionConfig).filter(HosxpConnectionConfig.is_enabled == True).first()  # noqa: E712
    return cfg.db_url if cfg else None


@router.get("/status")
def live_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """เช็คว่าตั้งค่าเชื่อม HOSxP แล้วหรือยัง และเชื่อมได้จริงไหม"""
    db_url = _get_db_url(db)
    if not db_url:
        return {"configured": False, "reachable": False,
                "message": "ยังไม่ได้ตั้งค่าเชื่อมต่อฐาน HOSxP (ไปที่ ตั้งค่ากฎ → การเชื่อมต่อ HOSxP)"}
    try:
        test_connection(db_url)
        return {"configured": True, "reachable": True, "message": "เชื่อมต่อ HOSxP ได้"}
    except HosxpLiveSourceError as e:
        return {"configured": True, "reachable": False, "message": str(e)}


@router.get("")
def live_prescreen(
    date_from: Optional[date] = Query(None, description="วันที่เริ่ม (default: วันนี้)"),
    date_to: Optional[date] = Query(None, description="วันที่สิ้นสุด (default: วันนี้)"),
    pttype: Optional[str] = Query(None, description="รหัสสิทธิ HOSxP คั่นด้วย comma เช่น 21,10"),
    limit: int = Query(500, ge=1, le=2000),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """ดึง visit จาก HOSxP แล้วรัน pre-screen ทันที — คืนผลโดยไม่บันทึก"""
    db_url = _get_db_url(db)
    if not db_url:
        raise HTTPException(400, "ยังไม่ได้ตั้งค่าเชื่อมต่อฐาน HOSxP")

    today = date.today()
    d1 = date_from or today
    d2 = date_to or today
    if d2 < d1:
        raise HTTPException(400, "ช่วงวันที่ไม่ถูกต้อง")
    if (d2 - d1) > timedelta(days=31):
        raise HTTPException(400, "ช่วงวันที่ต้องไม่เกิน 31 วัน (โหมดสดออกแบบไว้ตรวจข้อมูลล่าสุด)")

    pttypes = [p.strip() for p in pttype.split(",") if p.strip()] if pttype else None

    try:
        records = fetch_live_opd_records(db_url, d1, d2, pttypes, limit)
    except HosxpLiveSourceError as e:
        raise HTTPException(502, str(e))

    # กฎ custom ที่เปิดใช้อยู่ — ชุดเดียวกับ pre-screen ปกติ
    custom_rules = [
        {
            "rule_code": r.rule_code,
            "rule_name": r.rule_name,
            "rule_name_th": r.rule_name_th,
            "category": r.category,
            "condition_type": r.condition_type,
            "condition_value": r.condition_value,
            "severity": r.severity.value,
            "is_active": r.is_active,
        }
        for r in db.query(ValidationRule).filter(ValidationRule.is_active == True).all()  # noqa: E712
    ]

    results: list[dict[str, Any]] = []
    passed = failed = flagged_c = warned = 0
    total_amount = 0.0

    for rec in records:
        errors, is_c, flag_reason = run_prescreen(rec, custom_rules)
        has_error = any(e.severity == "ERROR" for e in errors)
        has_warning = any(e.severity == "WARNING" for e in errors)

        if is_c:
            status = "FLAGGED_C"
            flagged_c += 1
        elif has_error:
            status = "FAILED"
            failed += 1
        else:
            status = "PASSED"
            passed += 1
        if has_warning:
            warned += 1
        total_amount += rec.get("total_charge") or 0.0

        results.append({
            "vn": rec.get("claim_no"),
            "hn": rec.get("hn"),
            "pid": rec.get("pid"),
            "patient_name": rec.get("patient_name"),
            "visit_date": rec.get("visit_date"),
            "visit_time": rec.get("vsttime"),
            "pttype": rec.get("pttype"),
            "pdx": rec.get("pdx"),
            "adx": [rec.get(f"adx{i}") for i in range(1, 5) if rec.get(f"adx{i}")],
            "total_charge": rec.get("total_charge") or 0.0,
            "status": status,
            "flag_reason": flag_reason if is_c else None,
            "errors": [
                {
                    "code": e.error_code,
                    "category": e.error_category,
                    "field": e.error_field,
                    "message_th": e.error_message_th,
                    "severity": e.severity,
                    "current_value": e.current_value,
                }
                for e in errors
            ],
        })

    return {
        "fetched_at": datetime.now().isoformat(timespec="seconds"),
        "date_from": str(d1),
        "date_to": str(d2),
        "pttype": pttypes,
        "summary": {
            "total": len(results),
            "passed": passed,
            "failed": failed,
            "flagged_c": flagged_c,
            "warned": warned,
            "total_amount": round(total_amount, 2),
        },
        "records": results,
    }
