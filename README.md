# MUBR Claim Pre-screen System
**ระบบ Pre-screen ข้อมูลส่งเบิกค่ารักษาพยาบาล**  
ศูนย์การแพทย์มหิดลบำรุงรักษ์ จังหวัดนครสวรรค์

---

## Tech Stack
- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS
- **Backend**: FastAPI (Python) + SQLite (SQLAlchemy)
- **Charts**: Recharts
- **File Import**: pandas (Excel/CSV)

## การติดตั้ง (Installation)

### Prerequisites
- Node.js >= 18
- Python >= 3.9

### Backend
```bash
cd backend
python -m venv venv
.\venv\Scripts\pip install -r requirements.txt
.\venv\Scripts\pip install numpy pytz python-dateutil pydantic-core==2.18.2
```

### Frontend
```bash
cd frontend
npm install
```

## การเริ่มใช้งาน (Start)

```powershell
# เริ่มทั้งสอง service พร้อมกัน
.\start.ps1
```

หรือเริ่มแยกกัน:
```powershell
# Backend (Terminal 1)
cd backend ; .\venv\Scripts\uvicorn main:app --reload --port 8000

# Frontend (Terminal 2)
cd frontend ; npm run dev
```

เปิด: http://localhost:5173

## ฟีเจอร์หลัก

| ฟีเจอร์ | รายละเอียด |
|---------|------------|
| 📊 Dashboard | ภาพรวมสถิติ, กราฟผลการตรวจสอบ |
| 📤 นำเข้าข้อมูล | อัปโหลด Excel/CSV, รองรับ column หลายรูปแบบ |
| ✅ Pre-screen | ตรวจสอบอัตโนมัติตามกฎมาตรฐาน |
| 📋 รายการ Batch | ดูสถานะ, ค้นหา, กรอง |
| 📥 ส่งออกรายงาน | Excel 3 sheet (สรุป/รายการ/ข้อผิดพลาด) |
| ⚙️ ตั้งค่ากฎ | กำหนดกฎ Validation เพิ่มเติม |

## กฎการตรวจสอบมาตรฐาน

- **DOC**: ความครบถ้วน HN, PID (checksum), วันที่, สิทธิ์
- **ICD**: รูปแบบรหัส ICD-10 (PDX, ADX), ICD-9 (หัตถการ)
- **C_FLAG**: ตรวจสอบรหัสที่ทำให้ติด C Flag
- **DATE**: วันรักษา, วันจำหน่าย, LOS (IPD)
- **AMOUNT**: ยอดเบิก ≤ ยอดรวม, Sub-total check
- **DRG**: รหัส DRG + RW สำหรับ IPD
- **RIGHTS**: เลขสมาชิก SSO / CSMBS

## สิทธิ์ที่รองรับ
SSO · CSMBS · UC (บัตรทอง) · พนักงานส่วนท้องถิ่น (LGW) · E-Claim · ชำระเอง
