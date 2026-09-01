from __future__ import annotations

from typing import Any, Optional

from sqlalchemy import create_engine, inspect, text


class HosxpUserLookupError(Exception):
    pass


def _pick_column(columns: set[str], candidates: list[str]) -> Optional[str]:
    for col in candidates:
        if col in columns:
            return col
    return None


def discover_user_mapping(db_url: str) -> dict[str, Optional[str]]:
    engine = create_engine(db_url)
    insp = inspect(engine)

    table_candidates = [
        "opduser",
        "users",
        "user",
        "hosxp_user",
        "employee",
        "doctor",
    ]
    username_candidates = ["username", "loginname", "user_name", "login", "usercode", "code"]
    full_name_candidates = ["name", "full_name", "fullname", "staff_name", "doctorname", "fname"]
    active_candidates = ["active", "is_active", "status", "inuse", "enabled"]

    all_tables = set(insp.get_table_names())

    for table in table_candidates:
        if table not in all_tables:
            continue
        cols = {c["name"] for c in insp.get_columns(table)}
        username_col = _pick_column(cols, username_candidates)
        if not username_col:
            continue
        full_name_col = _pick_column(cols, full_name_candidates)
        active_col = _pick_column(cols, active_candidates)
        return {
            "user_table": table,
            "username_column": username_col,
            "full_name_column": full_name_col,
            "active_column": active_col,
        }

    raise HosxpUserLookupError("ไม่สามารถค้นหาตารางผู้ใช้ในฐาน HOSxP ได้ กรุณากำหนด mapping เอง")


def fetch_hosxp_users(
    db_url: str,
    user_table: str,
    username_column: str,
    full_name_column: Optional[str] = None,
    active_column: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    if not user_table or not username_column:
        raise HosxpUserLookupError("ยังไม่ได้กำหนดตารางหรือคอลัมน์ผู้ใช้ของ HOSxP")

    engine = create_engine(db_url)

    select_name = f", {full_name_column} AS full_name" if full_name_column else ""
    select_active = f", {active_column} AS raw_active" if active_column else ""
    where = ""
    params: dict[str, Any] = {"limit": max(1, min(limit, 500))}

    if search:
        where = f" WHERE LOWER({username_column}) LIKE :q"
        if full_name_column:
            where = f" WHERE LOWER({username_column}) LIKE :q OR LOWER({full_name_column}) LIKE :q"
        params["q"] = f"%{search.lower()}%"

    sql = (
        f"SELECT {username_column} AS username"
        f"{select_name}"
        f"{select_active}"
        f" FROM {user_table}"
        f"{where}"
        f" ORDER BY {username_column}"
        f" LIMIT :limit"
    )

    try:
        with engine.connect() as conn:
            rows = conn.execute(text(sql), params).mappings().all()
    except Exception as e:
        raise HosxpUserLookupError(f"เชื่อมต่อหรืออ่านข้อมูล HOSxP ไม่สำเร็จ: {e}")

    result: list[dict[str, Any]] = []
    for row in rows:
        username = str(row.get("username") or "").strip()
        if not username:
            continue
        active_val = row.get("raw_active")
        is_active = True
        if active_val is not None:
            active_text = str(active_val).strip().lower()
            is_active = active_text not in {"0", "false", "n", "no", "inactive"}

        result.append(
            {
                "hosxp_username": username,
                "full_name": (str(row.get("full_name") or "").strip() or None),
                "is_active": is_active,
            }
        )

    return result
