"""
MUBR Claim Pre-screen System — FastAPI Application
ศูนย์การแพทย์มหิดลบำรุงรักษ์ จังหวัดนครสวรรค์
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import engine, Base
from routers import auth, claims, prescreen, reports
from routers import claim_files, cpap_fix, live_prescreen, covid19_fix, rama_sh50_fix, tmt_fix
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

app.include_router(prescreen.router)
app.include_router(claims.router)
app.include_router(reports.router)
app.include_router(auth.router)
app.include_router(claim_files.router)
app.include_router(cpap_fix.router)
app.include_router(live_prescreen.router)
app.include_router(covid19_fix.router)
app.include_router(rama_sh50_fix.router)
app.include_router(tmt_fix.router)


@app.get("/health")
def health():
    return {"status": "ok", "service": "MUBR Claim Pre-screen"}
