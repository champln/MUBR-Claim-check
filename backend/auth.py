import os
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from database import SessionLocal, get_db
from models import User, UserRole, UserSource, HosxpConnectionConfig
from services import hosxp_auth

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
http_bearer = HTTPBearer(auto_error=False)

JWT_SECRET = os.getenv("JWT_SECRET", "mubr-dev-secret-change-me")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", "720"))


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


def validate_password_policy(password: str) -> None:
    if len(password) < 8:
        raise ValueError("รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร")
    if not any(c.isupper() for c in password):
        raise ValueError("รหัสผ่านต้องมีตัวพิมพ์ใหญ่ (A-Z) อย่างน้อย 1 ตัว")
    if not any(c.islower() for c in password):
        raise ValueError("รหัสผ่านต้องมีตัวพิมพ์เล็ก (a-z) อย่างน้อย 1 ตัว")
    if not any(c.isdigit() for c in password):
        raise ValueError("รหัสผ่านต้องมีตัวเลขอย่างน้อย 1 ตัว")


def create_access_token(user: User) -> str:
    now = datetime.now(timezone.utc)
    expire = now + timedelta(minutes=JWT_EXPIRE_MINUTES)
    payload = {
        "sub": str(user.id),
        "username": user.username,
        "role": user.role.value,
        "exp": expire,
        "iat": now,
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def authenticate_user(db: Session, username: str, password: str) -> Optional[User]:
    user = db.query(User).filter(User.username == username).first()
    if not user or not user.is_active:
        return None

    # ผู้ใช้จาก HOSxP + ตั้ง live-auth ไว้ -> ยืนยันรหัสสดกับฐาน HOSxP
    if user.source == UserSource.HOSXP:
        cfg = db.query(HosxpConnectionConfig).first()
        if (
            cfg and cfg.is_enabled and cfg.auth_method
            and cfg.user_table and cfg.username_column and cfg.password_column
        ):
            try:
                ok = hosxp_auth.verify_password(
                    cfg.db_url, cfg.user_table, cfg.username_column,
                    cfg.password_column, cfg.auth_method,
                    user.external_ref or username, password,
                )
            except hosxp_auth.HosxpAuthError:
                return None
            return user if ok else None
        # ยังไม่ได้ตั้ง live-auth -> ตกไปใช้ hash ในระบบ (รหัสชั่วคราว)

    if not verify_password(password, user.password_hash):
        return None
    return user


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(http_bearer),
    db: Session = Depends(get_db),
) -> User:
    if not credentials or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="ยังไม่ได้เข้าสู่ระบบ")

    token = credentials.credentials
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = int(payload.get("sub", "0"))
    except (JWTError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="โทเคนไม่ถูกต้อง")

    user = db.query(User).filter(User.id == user_id, User.is_active == True).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="ผู้ใช้ไม่ถูกต้อง")

    return user


def require_roles(*roles: UserRole):
    def _guard(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in set(roles):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="ไม่มีสิทธิ์เข้าถึงทรัพยากรนี้",
            )
        return current_user

    return _guard


def seed_default_admin() -> None:
    username = os.getenv("DEFAULT_ADMIN_USERNAME", "admin")
    password = os.getenv("DEFAULT_ADMIN_PASSWORD", "admin1234")
    full_name = os.getenv("DEFAULT_ADMIN_NAME", "System Administrator")

    db = SessionLocal()
    try:
        exists = db.query(User).filter(User.username == username).first()
        if exists:
            return
        db.add(
            User(
                username=username,
                full_name=full_name,
                password_hash=get_password_hash(password),
                role=UserRole.ADMIN,
                is_active=True,
            )
        )
        db.commit()
    finally:
        db.close()
