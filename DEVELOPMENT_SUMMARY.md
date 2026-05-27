# Development Summary: MUBR Claim Pre-screen System

## Project Goal
พัฒนาระบบ Pre-screen ข้อมูลส่งเบิกค่ารักษาพยาบาล สำหรับศูนย์การแพทย์มหิดลบำรุงรักษ์ จังหวัดนครสวรรค์ เพื่อช่วยตรวจจับข้อผิดพลาดก่อนส่งเบิกจริง ลดการถูกตีกลับ และเพิ่มความเร็วในการตรวจสอบงาน

## Implemented Architecture
- Frontend: React 18 + TypeScript + Vite + Tailwind CSS
- Backend: FastAPI + SQLAlchemy + SQLite
- Data Import: Excel/CSV (pandas, openpyxl, xlrd)
- Reporting: Export Excel (3 sheets)
- API Docs: Swagger UI ผ่าน `/docs`

## Completed Modules

### 1) Backend Core
- ออกแบบฐานข้อมูลและ ORM models สำหรับ Batch, Claim, Error, Rule, Drug Price
- สร้าง API routers หลัก:
  - `/prescreen` สำหรับอัปโหลดและรันตรวจสอบ
  - `/batches` สำหรับดู/ลบ/ดูรายละเอียด batch และ claim
  - `/dashboard`, `/reports/{batch_id}/export`, `/rules` สำหรับรายงานและตั้งค่ากฎ
- ตั้งค่า CORS รองรับการเชื่อมต่อจาก Frontend

### 2) Validation Engine
- ตรวจสอบความครบถ้วนข้อมูลเอกสาร (DOC)
- ตรวจสอบรหัส ICD-10 / ICD-9 และเงื่อนไข PDX/ADX
- ตรวจ C Flag จากชุดรหัสที่กำหนด
- ตรวจสอบวันที่รักษาและความสอดคล้องของ LOS
- ตรวจสอบจำนวนเงินและเงื่อนไขการเบิก
- ตรวจสอบสิทธิ์ตามประเภท claim (เช่น SSO/CSMBS)
- รองรับ custom validation rules เพิ่มเติม

### 3) Frontend Application
- Dashboard แสดงสถิติรวม, กราฟแนวโน้ม, error breakdown
- Upload Page สำหรับนำเข้าไฟล์และกำหนด metadata การส่งเบิก
- Batch List/Detail สำหรับดูผลราย batch และ drill-down ราย claim
- Reports Page สำหรับสรุปผลและ export รายงาน
- Settings Page สำหรับจัดการกฎ validation

### 4) Startup & Operation
- เพิ่ม `start.ps1` สำหรับเริ่ม Backend และ Frontend พร้อมกัน
- รองรับการรันแยก service ได้ทั้งสองฝั่ง

## Key Fixes During Development
- ปรับ dependency ของ Uvicorn บน Windows ให้หลีกเลี่ยงปัญหา build greenlet
- แก้ mismatch ของ `pydantic` และ `pydantic-core`
- เติม dependencies ที่จำเป็นของ pandas/openpyxl
- แก้ import path ใน `backend/services/__init__.py`
- ปรับเวอร์ชัน frontend dependencies ให้ทำงานได้กับ Node.js 14 ในเครื่องทดสอบ

## Verification Results
- Backend import check: PASS
- Database table creation: PASS
- Pre-screen function test: PASS
- TypeScript check (`tsc --noEmit`): PASS
- Vite production build: PASS
- API upload test (`/prescreen/upload`): PASS (HTTP 200)
- End-to-end UI navigation and data display: PASS

## Test Artifact
- สร้างไฟล์ตัวอย่าง `test_data.xlsx` สำหรับทดสอบ upload และ pre-screen
- ผลทดสอบตัวอย่างล่าสุด: 5 records (ผ่านบางส่วน/ไม่ผ่านบางส่วนตามกฎที่ตั้งไว้)

## How to Run
### Option A: One command
- รัน `start.ps1` ที่ root ของโปรเจกต์

### Option B: Run separately
1. Backend
   - `cd backend`
   - `./venv/Scripts/python.exe -m uvicorn main:app --reload --port 8000`
2. Frontend
   - `cd frontend`
   - `node_modules/.bin/vite dev --port 5173`

## Service URLs
- Frontend: http://localhost:5173
- Backend API: http://localhost:8000
- Swagger Docs: http://localhost:8000/docs

## Current Status
พร้อมใช้งานระดับต้นแบบ (MVP) สำหรับ workflow การตรวจสอบก่อนส่งเบิก พร้อมหน้าจอและ API ครบตามขอบเขตที่กำหนด
