from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session
from datetime import datetime, timezone
import secrets
from typing import Optional

from auth import (
    authenticate_user,
    create_access_token,
    get_current_user,
    get_password_hash,
    require_roles,
    validate_password_policy,
    verify_password,
)
from database import get_db
from models import (
    HosxpConnectionConfig,
    HosxpUserSelection,
    LoginAuditLog,
    User,
    UserAuditLog,
    UserRole,
    UserSource,
)
from services.hosxp_user_source import HosxpUserLookupError, discover_user_mapping, fetch_hosxp_users
from schemas import (
    ChangePasswordRequest,
    HosxpConnectionConfigOut,
    HosxpConnectionConfigUpsertRequest,
    HosxpDetectAuthRequest,
    HosxpDetectAuthResult,
    HosxpSelectionBulkUpsertRequest,
    HosxpSelectionBulkUpsertResult,
    HosxpSyncResult,
    HosxpUserCandidateOut,
    HosxpUserSelectionCreateRequest,
    HosxpUserSelectionOut,
    HosxpUserSelectionUpdateRequest,
    LoginRequest,
    LoginAuditLogOut,
    LoginResponse,
    MessageResponse,
    UserAuditLogOut,
    UserCreateRequest,
    UserOut,
    UserUpdateRequest,
)

router = APIRouter(prefix="/auth", tags=["Authentication"])


def _write_audit(
    db: Session,
    actor_user_id: int,
    action: str,
    target_user_id: Optional[int] = None,
    detail: Optional[str] = None,
) -> None:
    db.add(
        UserAuditLog(
            actor_user_id=actor_user_id,
            target_user_id=target_user_id,
            action=action,
            detail=detail,
        )
    )


def _get_client_ip(request: Request) -> Optional[str]:
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    return request.client.host if request.client else None


def _write_login_audit(
    db: Session,
    username: str,
    success: bool,
    request: Request,
    user_id: Optional[int] = None,
    reason: Optional[str] = None,
) -> None:
    db.add(
        LoginAuditLog(
            username=username,
            user_id=user_id,
            success=success,
            ip_address=_get_client_ip(request),
            user_agent=request.headers.get("user-agent"),
            reason=reason,
        )
    )


@router.post("/login", response_model=LoginResponse)
def login(body: LoginRequest, request: Request, db: Session = Depends(get_db)):
    username = body.username.strip()
    user = authenticate_user(db, username, body.password)
    if not user:
        _write_login_audit(
            db,
            username=username,
            success=False,
            request=request,
            reason="invalid_credentials",
        )
        db.commit()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง")

    token = create_access_token(user)
    _write_login_audit(
        db,
        username=username,
        user_id=user.id,
        success=True,
        request=request,
        reason="ok",
    )
    db.commit()
    return LoginResponse(access_token=token, user=user)


@router.get("/me", response_model=UserOut)
def me(current_user: User = Depends(get_current_user)):
    return current_user


@router.get("/users", response_model=list[UserOut])
def list_users(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN)),
):
    return db.query(User).order_by(User.id).all()


@router.post("/users", response_model=UserOut)
def create_user(
    body: UserCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN)),
):
    username = body.username.strip()
    existing = db.query(User).filter(User.username == username).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"username '{username}' ถูกใช้งานแล้ว")

    try:
        validate_password_policy(body.password)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    user = User(
        username=username,
        full_name=body.full_name,
        password_hash=get_password_hash(body.password),
        source=UserSource.LOCAL,
        role=body.role,
        is_active=True,
    )
    db.add(user)
    db.flush()
    _write_audit(
        db,
        actor_user_id=current_user.id,
        target_user_id=user.id,
        action="USER_CREATED",
        detail=f"role={body.role.value}",
    )
    db.commit()
    db.refresh(user)
    return user


@router.patch("/users/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    body: UserUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN)),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="ไม่พบผู้ใช้")

    audit_changes: list[str] = []

    if body.role is not None:
        if user.role != body.role:
            audit_changes.append(f"role:{user.role.value}->{body.role.value}")
        user.role = body.role
    if body.is_active is not None:
        if user.id == current_user.id and body.is_active is False:
            raise HTTPException(status_code=400, detail="ไม่สามารถปิดการใช้งานบัญชีตัวเอง")
        if user.is_active != body.is_active:
            audit_changes.append(f"is_active:{user.is_active}->{body.is_active}")
        user.is_active = body.is_active
    if body.full_name is not None:
        if user.full_name != body.full_name:
            audit_changes.append("full_name:changed")
        user.full_name = body.full_name
    if body.password:
        try:
            validate_password_policy(body.password)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        user.password_hash = get_password_hash(body.password)
        audit_changes.append("password:changed")

    if audit_changes:
        _write_audit(
            db,
            actor_user_id=current_user.id,
            target_user_id=user.id,
            action="USER_UPDATED",
            detail=", ".join(audit_changes),
        )

    db.commit()
    db.refresh(user)
    return user


@router.post("/change-password", response_model=MessageResponse)
def change_password(
    body: ChangePasswordRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not verify_password(body.current_password, current_user.password_hash):
        raise HTTPException(status_code=400, detail="รหัสผ่านปัจจุบันไม่ถูกต้อง")
    if body.current_password == body.new_password:
        raise HTTPException(status_code=400, detail="รหัสผ่านใหม่ต้องไม่ซ้ำรหัสผ่านเดิม")

    try:
        validate_password_policy(body.new_password)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    current_user.password_hash = get_password_hash(body.new_password)
    _write_audit(
        db,
        actor_user_id=current_user.id,
        target_user_id=current_user.id,
        action="PASSWORD_CHANGED",
        detail="user changed own password",
    )
    db.commit()
    return {"message": "เปลี่ยนรหัสผ่านเรียบร้อยแล้ว"}


@router.get("/audit-logs", response_model=list[UserAuditLogOut])
def list_audit_logs(
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN)),
):
    max_limit = max(1, min(limit, 500))
    return (
        db.query(UserAuditLog)
        .order_by(UserAuditLog.created_at.desc())
        .limit(max_limit)
        .all()
    )


@router.get("/login-logs", response_model=list[LoginAuditLogOut])
def list_login_logs(
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN)),
):
    max_limit = max(1, min(limit, 500))
    return (
        db.query(LoginAuditLog)
        .order_by(LoginAuditLog.created_at.desc())
        .limit(max_limit)
        .all()
    )


@router.get("/hosxp-selections", response_model=list[HosxpUserSelectionOut])
def list_hosxp_selections(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN)),
):
    return db.query(HosxpUserSelection).order_by(HosxpUserSelection.id).all()


@router.post("/hosxp-selections", response_model=HosxpUserSelectionOut)
def create_hosxp_selection(
    body: HosxpUserSelectionCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN)),
):
    hosxp_username = body.hosxp_username.strip()
    existing = db.query(HosxpUserSelection).filter(HosxpUserSelection.hosxp_username == hosxp_username).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"hosxp user '{hosxp_username}' ถูกเลือกแล้ว")

    item = HosxpUserSelection(
        hosxp_username=hosxp_username,
        full_name=body.full_name,
        role=body.role,
        is_active=body.is_active,
        selected_by_user_id=current_user.id,
    )
    db.add(item)
    db.flush()
    _write_audit(
        db,
        actor_user_id=current_user.id,
        target_user_id=current_user.id,
        action="HOSXP_SELECTION_CREATED",
        detail=f"hosxp_username={hosxp_username}, role={body.role.value}, active={body.is_active}",
    )
    db.commit()
    db.refresh(item)
    return item


@router.patch("/hosxp-selections/{selection_id}", response_model=HosxpUserSelectionOut)
def update_hosxp_selection(
    selection_id: int,
    body: HosxpUserSelectionUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN)),
):
    item = db.query(HosxpUserSelection).filter(HosxpUserSelection.id == selection_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="ไม่พบรายการผู้ใช้ HOSxP")

    changes: list[str] = []
    if body.full_name is not None and body.full_name != item.full_name:
        item.full_name = body.full_name
        changes.append("full_name")
    if body.role is not None and body.role != item.role:
        changes.append(f"role:{item.role.value}->{body.role.value}")
        item.role = body.role
    if body.is_active is not None and body.is_active != item.is_active:
        changes.append(f"is_active:{item.is_active}->{body.is_active}")
        item.is_active = body.is_active

    if changes:
        _write_audit(
            db,
            actor_user_id=current_user.id,
            target_user_id=current_user.id,
            action="HOSXP_SELECTION_UPDATED",
            detail=f"hosxp_username={item.hosxp_username}, changes={', '.join(changes)}",
        )

    db.commit()
    db.refresh(item)
    return item


@router.post("/hosxp-selections/sync", response_model=HosxpSyncResult)
def sync_hosxp_selections(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN)),
):
    rows = db.query(HosxpUserSelection).all()
    created_users = 0
    updated_users = 0
    deactivated_users = 0
    now = datetime.now(timezone.utc)

    for row in rows:
        user = db.query(User).filter(User.username == row.hosxp_username).first()
        if row.is_active:
            if not user:
                temp_password = f"Temp-{secrets.token_urlsafe(12)}A1"
                user = User(
                    username=row.hosxp_username,
                    full_name=row.full_name,
                    password_hash=get_password_hash(temp_password),
                    source=UserSource.HOSXP,
                    external_ref=row.hosxp_username,
                    role=row.role,
                    is_active=True,
                )
                db.add(user)
                created_users += 1
            else:
                user.full_name = row.full_name
                user.role = row.role
                user.is_active = True
                user.source = UserSource.HOSXP
                user.external_ref = row.hosxp_username
                updated_users += 1
        else:
            if user and user.is_active:
                user.is_active = False
                deactivated_users += 1

        row.last_synced_at = now

    _write_audit(
        db,
        actor_user_id=current_user.id,
        target_user_id=current_user.id,
        action="HOSXP_SELECTION_SYNC",
        detail=f"created={created_users}, updated={updated_users}, deactivated={deactivated_users}",
    )
    db.commit()

    return HosxpSyncResult(
        created_users=created_users,
        updated_users=updated_users,
        deactivated_users=deactivated_users,
    )


_DRIVERS = {"postgresql": "postgresql+psycopg2", "mysql": "mysql+pymysql"}
_DEFAULT_PORTS = {"postgresql": 5432, "mysql": 3306}


def _parse_db_url(db_url: Optional[str]) -> dict:
    """แยก DB URL เป็นช่องแบบหน้าจอ HOSxP (รหัสผ่านไม่ออกไปนอกฟังก์ชันนี้ยกเว้นตอนประกอบใหม่)"""
    from sqlalchemy.engine import make_url
    if not db_url:
        return {}
    try:
        u = make_url(db_url)
    except Exception:
        return {}
    backend = u.get_backend_name()
    return {
        "db_type": "postgresql" if backend.startswith("postgres") else backend,
        "host": u.host, "port": u.port, "database": u.database,
        "db_username": u.username, "password": u.password,
    }


def _build_db_url(body: HosxpConnectionConfigUpsertRequest, existing_url: Optional[str]) -> str:
    """ประกอบ URL จากช่องที่กรอก — URL.create เข้ารหัส @ # : / ในรหัสผ่านให้เอง"""
    from sqlalchemy.engine import URL
    if not body.host:
        if body.db_url and body.db_url.strip():
            return body.db_url.strip()
        if existing_url:
            return existing_url
        raise HTTPException(status_code=400, detail="กรุณากรอกชื่อเครื่อง (Server) ของฐาน HOSxP")
    db_type = (body.db_type or "postgresql").lower()
    if db_type not in _DRIVERS:
        raise HTTPException(status_code=400, detail="ประเภทฐานข้อมูลต้องเป็น PostgreSQL หรือ MySQL")
    if not body.database or not body.db_username:
        raise HTTPException(status_code=400, detail="กรุณากรอกชื่อฐานข้อมูลและรหัสผู้ใช้งาน")
    password = body.db_password
    if not password:
        old = _parse_db_url(existing_url)
        password = old.get("password")
        if not password:
            raise HTTPException(status_code=400, detail="กรุณากรอกรหัสผ่านฐานข้อมูล")
    return URL.create(
        _DRIVERS[db_type], username=body.db_username.strip(), password=password,
        host=body.host.strip(), port=body.port or _DEFAULT_PORTS[db_type], database=body.database.strip(),
    ).render_as_string(hide_password=False)


def _config_out(cfg: Optional[HosxpConnectionConfig]) -> Optional[HosxpConnectionConfigOut]:
    if not cfg:
        return None
    p = _parse_db_url(cfg.db_url)
    return HosxpConnectionConfigOut(
        id=cfg.id, db_type=p.get("db_type"), host=p.get("host"), port=p.get("port"),
        database=p.get("database"), db_username=p.get("db_username"), has_password=bool(p.get("password")),
        user_table=cfg.user_table, username_column=cfg.username_column,
        full_name_column=cfg.full_name_column, active_column=cfg.active_column,
        password_column=cfg.password_column, auth_method=cfg.auth_method,
        is_enabled=cfg.is_enabled, updated_by_user_id=cfg.updated_by_user_id, updated_at=cfg.updated_at,
    )


@router.get("/hosxp-config", response_model=Optional[HosxpConnectionConfigOut])
def get_hosxp_config(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN)),
):
    return _config_out(db.query(HosxpConnectionConfig).first())


@router.post("/hosxp-config/test")
def test_hosxp_config(
    body: HosxpConnectionConfigUpsertRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN)),
):
    """ทดสอบเชื่อมต่อด้วยค่าที่กรอกในฟอร์ม (ยังไม่บันทึก) — รหัสผ่านว่างจะใช้ที่บันทึกไว้"""
    from services.hosxp_live_source import HosxpLiveSourceError, test_connection
    cfg = db.query(HosxpConnectionConfig).first()
    url = _build_db_url(body, cfg.db_url if cfg else None)
    try:
        test_connection(url)
    except HosxpLiveSourceError as e:
        # ข้อความจาก driver อาจมี URL — ตัดรหัสผ่านออกก่อนส่งกลับ
        msg = str(e)
        pw = _parse_db_url(url).get("password")
        if pw:
            msg = msg.replace(pw, "***")
        return {"ok": False, "message": msg}
    return {"ok": True, "message": "เชื่อมต่อฐาน HOSxP สำเร็จ"}


@router.put("/hosxp-config", response_model=HosxpConnectionConfigOut)
def upsert_hosxp_config(
    body: HosxpConnectionConfigUpsertRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN)),
):
    cfg = db.query(HosxpConnectionConfig).first()
    db_url = _build_db_url(body, cfg.db_url if cfg else None)
    if not cfg:
        cfg = HosxpConnectionConfig(
            db_url=db_url,
            user_table=(body.user_table or None),
            username_column=(body.username_column or None),
            full_name_column=(body.full_name_column or None),
            active_column=(body.active_column or None),
            password_column=(body.password_column or None),
            auth_method=(body.auth_method or None),
            is_enabled=body.is_enabled,
            updated_by_user_id=current_user.id,
        )
        db.add(cfg)
    else:
        cfg.db_url = db_url
        cfg.user_table = body.user_table or None
        cfg.username_column = body.username_column or None
        cfg.full_name_column = body.full_name_column or None
        cfg.active_column = body.active_column or None
        cfg.password_column = body.password_column or None
        cfg.auth_method = body.auth_method or None
        cfg.is_enabled = body.is_enabled
        cfg.updated_by_user_id = current_user.id

    # Auto-discover table/columns if admin did not provide mapping.
    if not cfg.user_table or not cfg.username_column:
        try:
            discovered = discover_user_mapping(cfg.db_url)
            cfg.user_table = cfg.user_table or discovered.get("user_table")
            cfg.username_column = cfg.username_column or discovered.get("username_column")
            cfg.full_name_column = cfg.full_name_column or discovered.get("full_name_column")
            cfg.active_column = cfg.active_column or discovered.get("active_column")
        except Exception:
            # เชื่อมฐานไม่ได้ตอนบันทึก (เครื่องดับ/กรอกผิด) ก็ยังบันทึกการตั้งค่าได้ — ค้นหาตารางผู้ใช้ภายหลัง
            pass

    _write_audit(
        db,
        actor_user_id=current_user.id,
        target_user_id=current_user.id,
        action="HOSXP_CONFIG_UPDATED",
        detail=f"enabled={cfg.is_enabled}, table={cfg.user_table}, username_col={cfg.username_column}",
    )
    db.commit()
    db.refresh(cfg)
    return _config_out(cfg)


@router.post("/hosxp-config/detect-auth", response_model=HosxpDetectAuthResult)
def detect_hosxp_auth(
    body: HosxpDetectAuthRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN)),
):
    """
    admin กรอก user/รหัส HOSxP จริง 1 ครั้ง -> ระบบหาว่าใช้คอลัมน์/วิธีไหนยืนยันรหัส
    แล้วบันทึกลง config อัตโนมัติ (ไม่เก็บรหัสที่กรอก)
    """
    from services.hosxp_auth import detect_auth, HosxpAuthError

    cfg = db.query(HosxpConnectionConfig).first()
    if not cfg or not cfg.db_url:
        raise HTTPException(400, "ยังไม่ได้ตั้งค่าการเชื่อมต่อ HOSxP")
    if not cfg.user_table or not cfg.username_column:
        raise HTTPException(400, "ยังไม่ได้กำหนดตาราง/คอลัมน์ผู้ใช้ของ HOSxP")

    try:
        found = detect_auth(
            cfg.db_url, cfg.user_table, cfg.username_column,
            body.username.strip(), body.password,
            password_col=cfg.password_column,
        )
    except HosxpAuthError as e:
        raise HTTPException(422, str(e))

    cfg.password_column = found["password_column"]
    cfg.auth_method = found["auth_method"]
    cfg.updated_by_user_id = current_user.id
    _write_audit(
        db,
        actor_user_id=current_user.id,
        target_user_id=current_user.id,
        action="HOSXP_AUTH_DETECTED",
        detail=f"column={found['password_column']}, method={found['auth_method']}",
    )
    db.commit()
    return HosxpDetectAuthResult(
        password_column=found["password_column"],
        auth_method=found["auth_method"],
        saved=True,
    )


@router.get("/hosxp-users/candidates", response_model=list[HosxpUserCandidateOut])
def list_hosxp_candidates(
    search: Optional[str] = None,
    limit: int = 100,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN)),
):
    cfg = db.query(HosxpConnectionConfig).first()
    if not cfg or not cfg.is_enabled:
        raise HTTPException(status_code=400, detail="ยังไม่ได้ตั้งค่า HOSxP connection หรือถูกปิดใช้งาน")

    try:
        rows = fetch_hosxp_users(
            db_url=cfg.db_url,
            user_table=cfg.user_table or "",
            username_column=cfg.username_column or "",
            full_name_column=cfg.full_name_column,
            active_column=cfg.active_column,
            search=search,
            limit=limit,
        )
    except HosxpUserLookupError as e:
        raise HTTPException(status_code=422, detail=str(e))

    selected = {
        r.hosxp_username: r
        for r in db.query(HosxpUserSelection)
        .filter(HosxpUserSelection.hosxp_username.in_([x["hosxp_username"] for x in rows]))
        .all()
    }

    return [
        HosxpUserCandidateOut(
            hosxp_username=x["hosxp_username"],
            full_name=x.get("full_name"),
            is_active=x.get("is_active", True),
            already_selected=x["hosxp_username"] in selected,
            selected_active=selected[x["hosxp_username"]].is_active if x["hosxp_username"] in selected else False,
        )
        for x in rows
    ]


@router.post("/hosxp-selections/bulk-upsert", response_model=HosxpSelectionBulkUpsertResult)
def bulk_upsert_hosxp_selections(
    body: HosxpSelectionBulkUpsertRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN)),
):
    if not body.items:
        raise HTTPException(status_code=400, detail="items payload is empty")

    created = 0
    updated = 0

    for item in body.items:
        username = item.hosxp_username.strip()
        existing = db.query(HosxpUserSelection).filter(HosxpUserSelection.hosxp_username == username).first()
        if existing:
            existing.full_name = item.full_name
            existing.role = item.role
            existing.is_active = item.is_active
            updated += 1
        else:
            db.add(
                HosxpUserSelection(
                    hosxp_username=username,
                    full_name=item.full_name,
                    role=item.role,
                    is_active=item.is_active,
                    selected_by_user_id=current_user.id,
                )
            )
            created += 1

    _write_audit(
        db,
        actor_user_id=current_user.id,
        target_user_id=current_user.id,
        action="HOSXP_SELECTION_BULK_UPSERT",
        detail=f"created={created}, updated={updated}",
    )
    db.commit()

    return HosxpSelectionBulkUpsertResult(created=created, updated=updated)
