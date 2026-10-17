# ตั้งค่า Pre-screen สด (เชื่อมฐาน HOSxP)

Pre-screen สดดึง visit ผู้ป่วยนอกจากฐาน HOSxP มาตรวจตามรอบเวลา (30 วินาที – 5 นาที)
เพื่อเห็นปัญหาที่จะทำให้ไฟล์ส่งเบิกติด C ตั้งแต่ก่อน export — แก้ที่ต้นทางได้ทันที

## 1. สร้าง user แบบอ่านอย่างเดียว (ทำโดย IT / ผู้ดูแลฐาน HOSxP)

ให้สิทธิ์ `SELECT` เฉพาะตารางที่ระบบใช้ — ไม่ต้องใช้ user ที่แก้ไขข้อมูลได้

**HOSxP XE (PostgreSQL)**

```sql
CREATE USER mubr_readonly WITH PASSWORD '<ตั้งรหัสผ่านเอง>';
GRANT CONNECT ON DATABASE hos TO mubr_readonly;
GRANT USAGE ON SCHEMA public TO mubr_readonly;
GRANT SELECT ON ovst, patient, ovstdiag, opitemrece, drugitems, nondrugitems,
                drugusage, sp_use, doctor, pttype TO mubr_readonly;
```

**HOSxP รุ่นเก่า (MySQL)**

```sql
CREATE USER 'mubr_readonly'@'<IP เครื่องเซิร์ฟเวอร์ MUBR>' IDENTIFIED BY '<ตั้งรหัสผ่านเอง>';
GRANT SELECT ON hos.ovst TO 'mubr_readonly'@'<IP>';
GRANT SELECT ON hos.patient TO 'mubr_readonly'@'<IP>';
GRANT SELECT ON hos.ovstdiag TO 'mubr_readonly'@'<IP>';
GRANT SELECT ON hos.opitemrece TO 'mubr_readonly'@'<IP>';
GRANT SELECT ON hos.drugitems TO 'mubr_readonly'@'<IP>';
GRANT SELECT ON hos.nondrugitems TO 'mubr_readonly'@'<IP>';
GRANT SELECT ON hos.drugusage TO 'mubr_readonly'@'<IP>';
GRANT SELECT ON hos.sp_use TO 'mubr_readonly'@'<IP>';
GRANT SELECT ON hos.doctor TO 'mubr_readonly'@'<IP>';
GRANT SELECT ON hos.pttype TO 'mubr_readonly'@'<IP>';
```

> ถ้าจะใช้ "ล็อกอินด้วยรหัส HOSxP" ด้วย ต้องให้ SELECT ตารางผู้ใช้ (เช่น `opduser`) เพิ่ม

## 2. ใส่การเชื่อมต่อในระบบ (ADMIN)

เมนู **ตั้งค่าระบบ → การเชื่อมต่อฐาน HOSxP** ใส่ DB URL แล้วกด **บันทึก** → **ทดสอบการเชื่อมต่อ**

- PostgreSQL: `postgresql+psycopg2://mubr_readonly:<รหัส>@<host>:5432/hos`
- MySQL: `mysql+pymysql://mubr_readonly:<รหัส>@<host>:3306/hos`

(รหัสผ่านที่มีอักขระพิเศษ เช่น `@ : / #` ต้องเข้ารหัสแบบ URL เช่น `@` → `%40`)

## 3. ตรวจความพร้อม

เปิดเมนู **Pre-screen สด** — กรอบ "ความพร้อมของฐาน HOSxP" จะบอกว่ากฎแต่ละข้อใช้ได้หรือไม่
(ระบบอ่านแค่โครงสร้างตาราง ไม่อ่านข้อมูลผู้ป่วย) กฎที่ตารางไม่ครบจะถูกข้ามโดยไม่ทำให้หน้าล้ม

| กฎ | ใช้ตาราง |
|----|---------|
| ข้อมูล visit พื้นฐาน (ต้องมี) | ovst, patient, ovstdiag, opitemrece |
| R24 วิธีใช้ยา (ว่าง / มี `& < >`) | opitemrece, drugitems, drugusage, sp_use |
| T42 วันที่รายการไม่ตรงวัน visit | opitemrece.rxdate |
| P05 แพทย์ CPAP/PSG (+ เตือนเตรียมเลขกำกับ P02) | ovst.doctor, doctor.licenseno, nondrugitems |
| FEE001–004 ค่าธรรมเนียมโรงพยาบาล 50 บาท (ตรวจ 1 หมอ คิด 50 บาท) | ovst.doctor/spclty, opitemrece.qty/paidst, nondrugitems, spclty, doctor |
| แสดงแผนก / ห้องตรวจ | ovst.spclty/main_dep/cur_dep, spclty, kskdepartment |

### กฎค่าธรรมเนียมโรงพยาบาล 50 บาท (ประกาศ ม.มหิดล มีผล 1 ต.ค. 2566)

ตรวจ 1 หมอ คิด 50 บาท ต่อผู้ป่วยต่อวัน · เป็นรายการ "ชำระเองเบิกไม่ได้" · ไม่นับค่าบริการทั่วไปผู้ป่วยนอก (55020)

| รหัส | กรณี | ระดับ |
|------|------|-------|
| FEE001 | วันเดียวกัน แพทย์คนเดียวกัน คิดค่าธรรมเนียมเกิน 1 ครั้ง | เตือน |
| FEE002 | ประเภทการชำระไม่ใช่ 03 ชำระเองเบิกไม่ได้ | ผิด |
| FEE003 | คิดในแผนกที่ไม่คิด: กายภาพบำบัด · ตรวจสุขภาพ · แผนไทย · แพทย์แผนจีน | ผิด |
| FEE004 | พบแพทย์คนละคนในวันเดียวกันแต่ไม่ได้คิด (เตือนเฉพาะวันที่ผู้ป่วยถูกคิดใน visit อื่นแล้ว) | เตือน |

visit ที่ยังไม่ลงแพทย์ผู้ตรวจจะไม่ถูกตัดสินเรื่องซ้ำ/ขาด

### การเชื่อมต่อ

ระบบใช้ connection กับฐาน HOSxP ไม่เกิน 4 เส้นพร้อมกัน (user อ่านอย่างเดียวของ รพ. จำกัด 10)

## การใช้งาน

- เลือกช่วงวันที่ / สิทธิ (pttype) แล้วตั้งรอบรีเฟรช — รอบแรกของวันแนะนำ 1 นาที
- visit ที่เข้ามาใหม่ตั้งแต่รอบก่อนมีป้าย **ใหม่** และขึ้นบนสุด · เปิด **เสียงเตือน** ได้เมื่อมีเคสใหม่ที่มีปัญหา
- หลายเครื่องเปิดพร้อมกัน เซิร์ฟเวอร์ใช้ผลรอบล่าสุดร่วมกัน 30 วินาที (ไม่ยิงฐาน HOSxP ซ้ำ)
  — ปุ่ม **ดึงข้อมูลตอนนี้** ดึงใหม่ทันทีเสมอ

## Pre-screen สด ผู้ป่วยใน (เมนู "Pre-screen สด ผู้ป่วยใน")

ดึงข้อมูลเฉพาะเมื่อเปิดหน้าผู้ป่วยใน · ต้องให้สิทธิ์ SELECT เพิ่ม: `ipt, an_stat, iptdiag, ipt_pttype, ward`

| โหมด | ดึงอะไร |
|------|--------|
| จำหน่ายแล้ว | ผู้ป่วยที่จำหน่ายในช่วงวันที่ (ไม่เกิน 31 วัน) — ชุดที่จะทำไฟล์ CIPN/AIPN |
| กำลังนอน | ผู้ป่วยที่ยังไม่จำหน่าย — ไม่ตรวจวันจำหน่าย/PDX/DRG |

| รหัส | ตรวจอะไร |
|------|---------|
| 31 | สิทธิกรมบัญชีกลาง (pttype.hipdata_code = OFC) ไม่มีเลขอนุมัตินอนโรงพยาบาล (ipt_pttype.auth_code) / ไม่ใช่ตัวพิมพ์ใหญ่ |
| ส่วนเกิน | มีรายการชำระส่วนเกิน (ชื่อมีคำว่า "ส่วนเกิน") ในหมวดที่ไม่ใช่ 01 ค่าห้อง/อาหาร หรือ 02 อวัยวะเทียม |
| ICD001–005 | PDX / วินิจฉัยรองจาก iptdiag (ไม่นับรหัสหัตถการ) |
| DATE001/003–005 | วันจำหน่ายก่อน admit · ไม่มีวันจำหน่าย · วันนอนผิดปกติ |
| DRG001–002 | ไม่มี DRG · RW/AdjRW เป็น 0 |
| DOC / RIGHTS | เหมือนผู้ป่วยนอก |

## กฎจากเมนูแก้ไฟล์เพิ่มเติม (OPD)

| รหัส | ตรวจอะไร | ตาราง |
|---|---|---|
| G04 | ยานอกบัญชีเหตุผล EF แต่คิดเป็นลูกหนี้สิทธิ (OPD + IPD) | ovst_presc_ned / ipt_presc_ned, drugitems_ned_reason_list |
| S41 | หัตถการไม่มี ICD-9-CM | doctor_operation, er_oper_code |
| T33 | สิทธิกรมบัญชีกลาง ค่าบริการทั่วไปผู้ป่วยนอกไม่ได้คิดเป็นลูกหนี้สิทธิ | pttype.paidst / hipdata_code |
