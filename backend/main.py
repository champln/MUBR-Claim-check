"""
MUBR Claim Pre-screen System — FastAPI Application
ศูนย์การแพทย์มหิดลบำรุงรักษ์ จังหวัดนครสวรรค์
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import engine, Base
from routers import claims, prescreen, reports

# Create all tables on startup
Base.metadata.create_all(bind=engine)

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


@app.get("/health")
def health():
    return {"status": "ok", "service": "MUBR Claim Pre-screen"}
