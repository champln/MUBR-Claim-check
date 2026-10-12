"""
API router: ประวัติการแก้ไฟล์ส่งเบิกของทุกเมนู (โหลดไฟล์ย้อนหลังได้)

- GET    /fix-history                    : รายการประวัติ (กรองเมนู / ปีงบ / คำค้น)
- GET    /fix-history/menus              : จำนวนประวัติแยกตามเมนู
- GET    /fix-history/fiscal-years       : ปีงบที่มีประวัติ (+ จำนวน)
- GET    /fix-history/{id}/download      : โหลดไฟล์ที่แก้แล้วซ้ำ
- DELETE /fix-history/{id}               : ลบประวัติรายการเดียว
- DELETE /fix-history?fiscal_year=2569   : เคลียร์ประวัติทั้งปีงบ (กรองเมนูได้)
"""
import io
import json
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import func as sfunc, or_
from sqlalchemy.orm import Session

from auth import get_current_user
from database import get_db
from models import FixHistory, User
from services.fix_history import MENU_LABELS

router = APIRouter(prefix="/fix-history", tags=["Fix History"])


class FixHistoryOut(BaseModel):
    id: int
    menu: str
    menu_label: str = ""
    session_name: str
    fiscal_year: Optional[int]
    service_date: Optional[str]
    pay_plan: Optional[str]
    changes: List[Any] = []
    result_filename: Optional[str]
    size_bytes: int = 0
    created_at: Any
    created_by: Optional[str] = None


def _out(row: FixHistory, users: dict) -> FixHistoryOut:
    try:
        changes = json.loads(row.changes or "[]")
    except Exception:
        changes = []
    return FixHistoryOut(
        id=row.id, menu=row.menu, menu_label=MENU_LABELS.get(row.menu, row.menu),
        session_name=row.session_name, fiscal_year=row.fiscal_year,
        service_date=row.service_date, pay_plan=row.pay_plan, changes=changes,
        result_filename=row.result_filename, size_bytes=row.size_bytes or 0,
        created_at=row.created_at, created_by=users.get(row.created_by_id),
    )


def _filtered(db: Session, menu: Optional[str], fiscal_year: Optional[int], q: Optional[str]):
    query = db.query(FixHistory)
    if menu:
        query = query.filter(FixHistory.menu == menu)
    if fiscal_year is not None:
        query = query.filter(FixHistory.fiscal_year == fiscal_year)
    if q and q.strip():
        like = f"%{q.strip()}%"
        query = query.filter(or_(FixHistory.session_name.ilike(like),
                                 FixHistory.result_filename.ilike(like),
                                 FixHistory.changes.ilike(like)))
    return query


@router.get("", response_model=List[FixHistoryOut])
def list_history(
    menu: Optional[str] = Query(None),
    fiscal_year: Optional[int] = Query(None),
    q: Optional[str] = Query(None),
    limit: int = Query(100, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rows = (_filtered(db, menu, fiscal_year, q)
            .order_by(FixHistory.created_at.desc(), FixHistory.id.desc())
            .limit(limit).all())
    ids = {r.created_by_id for r in rows if r.created_by_id}
    users = {u.id: (u.full_name or u.username) for u in db.query(User).filter(User.id.in_(ids)).all()} if ids else {}
    return [_out(r, users) for r in rows]


@router.get("/menus")
def list_menus(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = db.query(FixHistory.menu, sfunc.count(FixHistory.id)).group_by(FixHistory.menu).all()
    counts = dict(rows)
    return [{"menu": k, "label": v, "count": counts.get(k, 0)} for k, v in MENU_LABELS.items()]


@router.get("/fiscal-years")
def list_fiscal_years(
    menu: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = db.query(FixHistory.fiscal_year, sfunc.count(FixHistory.id))
    if menu:
        query = query.filter(FixHistory.menu == menu)
    rows = query.group_by(FixHistory.fiscal_year).order_by(FixHistory.fiscal_year.desc()).all()
    return [{"fiscal_year": fy, "count": c} for fy, c in rows]


@router.get("/{history_id}/download")
def download(history_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    row = db.query(FixHistory).filter(FixHistory.id == history_id).first()
    if not row or not row.result_blob:
        raise HTTPException(404, "ไม่พบไฟล์ผลลัพธ์")
    name = row.result_filename or "fixed"
    return StreamingResponse(
        io.BytesIO(row.result_blob), media_type=row.media_type or "application/octet-stream",
        headers={"Content-Disposition": f"attachment; filename={name}", "X-Filename": name,
                 "Access-Control-Expose-Headers": "X-Filename"},
    )


@router.delete("/{history_id}")
def delete_one(history_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    row = db.query(FixHistory).filter(FixHistory.id == history_id).first()
    if not row:
        raise HTTPException(404, "ไม่พบประวัติ")
    db.delete(row)
    db.commit()
    return {"deleted": history_id}


@router.delete("")
def clear_fiscal_year(
    fiscal_year: int = Query(..., description="ปีงบประมาณ (พ.ศ.) ที่จะเคลียร์"),
    menu: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    n = _filtered(db, menu, fiscal_year, None).delete(synchronize_session=False)
    db.commit()
    return {"message": f"เคลียร์ประวัติปีงบ {fiscal_year} จำนวน {n} รายการ", "deleted": n}
