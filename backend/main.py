"""
MUBR Claim Pre-screen System — FastAPI Application
ศูนย์การแพทย์มหิดลบำรุงรักษ์ จังหวัดนครสวรรค์
"""
import os

# โหลด backend/.env ก่อน import อื่น เพราะ auth.py อ่าน JWT_SECRET ตอน import
try:
    from dotenv import load_dotenv

    load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))
except ImportError:  # ไม่มี python-dotenv ก็ยังรันได้ (ใช้ค่า default/ตัวแปรระบบ)
    pass

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import engine, Base
from routers import auth, claims, prescreen, reports
from routers import claim_files, cpap_fix, live_prescreen, covid19_fix, rama_sh50_fix, tmt_fix
from routers import stdcode_fix, opd_fee_fix, svdate_fix, cipn_daterev
from auth import seed_default_admin

# Create all tables on startup
Base.metadata.create_all(bind=engine)


def _ensure_columns():
    """เพิ่มคอลัมน์ที่เพิ่มภายหลังให้ DB เดิม (idempotent, SQLite ADD COLUMN)"""
    from sqlalchemy import text, inspect
    insp = inspect(engine)
    tables = insp.get_table_names()
    if "cpap_fix_sessions" in tables:
        cols = {c["name"] for c in insp.get_columns("cpap_fix_sessions")}
        if "claim_types" not in cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE cpap_fix_sessions ADD COLUMN claim_types VARCHAR(50)"))
    if "claim_file_sessions" in tables:
        cols = {c["name"] for c in insp.get_columns("claim_file_sessions")}
        with engine.begin() as conn:
            if "source_zip" not in cols:
                conn.execute(text("ALTER TABLE claim_file_sessions ADD COLUMN source_zip BLOB"))
            if "source_filename" not in cols:
                conn.execute(text("ALTER TABLE claim_file_sessions ADD COLUMN source_filename VARCHAR(255)"))
            if "raw_edits" not in cols:
                conn.execute(text("ALTER TABLE claim_file_sessions ADD COLUMN raw_edits TEXT"))
    if "hosxp_connection_config" in tables:
        cols = {c["name"] for c in insp.get_columns("hosxp_connection_config")}
        with engine.begin() as conn:
            if "password_column" not in cols:
                conn.execute(text("ALTER TABLE hosxp_connection_config ADD COLUMN password_column VARCHAR(100)"))
            if "auth_method" not in cols:
                conn.execute(text("ALTER TABLE hosxp_connection_config ADD COLUMN auth_method VARCHAR(30)"))


_ensure_columns()
seed_default_admin()

app = FastAPI(
    title="MUBR Claim Pre-screen API",
    description="ระบบ Pre-screen ข้อมูลส่งเบิกค่ารักษาพยาบาล ศูนย์การแพทย์มหิดลบำรุงรักษ์",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_ROUTERS = [
    prescreen.router,
    claims.router,
    reports.router,
    auth.router,
    claim_files.router,
    cpap_fix.router,
    live_prescreen.router,
    covid19_fix.router,
    rama_sh50_fix.router,
    tmt_fix.router,
    stdcode_fix.router,
    opd_fee_fix.router,
    svdate_fix.router,
    cipn_daterev.router,
]

_FRONTEND_DIST = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend", "dist"
)
_SERVING_SPA = os.path.isdir(_FRONTEND_DIST)

# /api/... : เส้นทางจริงของ API ใช้ทั้งโหมด dev และ production
for _r in _ROUTERS:
    app.include_router(_r, prefix="/api")

# path เปล่า (/auth/...) : เฉพาะโหมด dev ที่ Vite proxy ตัด /api ออกให้แล้ว
# ห้ามลงทะเบียนตอนเสิร์ฟหน้าเว็บเอง ไม่งั้น API จะบังเส้นทางของหน้าเว็บ
# (เช่นเปิด /claim-files/5 ตรงๆ แล้วได้ JSON แทนหน้าจอ)
if not _SERVING_SPA:
    for _r in _ROUTERS:
        app.include_router(_r)


@app.get("/health")
@app.get("/api/health")
def health():
    return {"status": "ok", "service": "MUBR Claim Pre-screen"}


# ─── เสิร์ฟหน้าเว็บที่ build แล้ว (production: เหลือ process/พอร์ตเดียว) ──────────
# ต้องประกาศ "หลัง" ทุก API route เพราะเป็น catch-all
if _SERVING_SPA:
    from fastapi.responses import FileResponse
    from fastapi.staticfiles import StaticFiles

    _ASSETS_DIR = os.path.join(_FRONTEND_DIST, "assets")
    if os.path.isdir(_ASSETS_DIR):
        app.mount("/assets", StaticFiles(directory=_ASSETS_DIR), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa(full_path: str):
        """ไฟล์จริงส่งไฟล์นั้น, path อื่นส่ง index.html (React Router จัดการเอง)"""
        candidate = os.path.normpath(os.path.join(_FRONTEND_DIST, full_path))
        # กัน path traversal: ต้องอยู่ใต้ dist เท่านั้น
        if (full_path and candidate.startswith(_FRONTEND_DIST) and os.path.isfile(candidate)):
            return FileResponse(candidate)
        return FileResponse(os.path.join(_FRONTEND_DIST, "index.html"))
