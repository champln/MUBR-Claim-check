# Live Pre-screen — แนวทางตรวจ 25 หัวข้อปัญหาการเบิก

> สถานะ: **ร่าง logic / SQL ยังไม่เขียนโค้ดจริง**
> ตัวเลข "พบ" = รัน query กับฐาน HOSxP จริง ย้อนหลัง 30 วัน สิทธิ กบก./อปท. ผู้ป่วยนอก (นับจำนวนเท่านั้น)
> เงื่อนไขร่วมทุก query: `o.vstdate` ในช่วงที่ Live ดึง · `p.hipdata_code IN ('OFC','LGO')` · `(o.an IS NULL OR o.an='')` · รายการที่เบิก `oi.paidst='02'`

```sql
-- ส่วนต้นที่ใช้ร่วมกัน (เรียกว่า BASE ด้านล่าง)
FROM opitemrece oi
JOIN ovst o   ON o.vn = oi.vn
JOIN pttype p ON p.pttype = o.pttype
WHERE oi.vn IN :vns
  AND p.hipdata_code IN ('OFC','LGO')
  AND (oi.an IS NULL OR oi.an = '')
```

## 1. ภาพรวม 25 หัวข้อ

| # | หัวข้อ | ทำอัตโนมัติ | รหัสกฏ | พบ 30 วัน | สถานะ |
|---|---|---|---|---|---|
| 1 | ราคา Lab ผิด | ได้ | **LAB02** | 731 รายการ / 155 visit | ใหม่ |
| 2 | บันทึกรายการ 55020 ผิด | ได้บางส่วน | **SVC01** | ในเวลาแต่ลงวันหยุด: ตรวจได้ · เวลาลงทะเบียนก่อน 08:00: 849 (ไม่ใช่ปัญหา) | ใหม่ (+T33 เดิม) |
| 3 | รายการเบิกไม่ตรงตามจริง | ได้บางส่วน | **LAB01**, DUP01 | — | ใหม่ |
| 4 | ค่าหัตถการผ่าตัดไม่สอดคล้อง ว.177 | ได้บางส่วน | **OR177** | ต้องมีบัญชีรายการ | ใหม่ (ต่อจาก BND01) |
| 5 | ระบบแสดงค่าส่วนเกินไม่ถูกต้อง | ได้ | **EXC01** | 1,438 แถวส่วนเกิน / 1,369 visit | ใหม่ |
| 6 | เบิกแยกเวชภัณฑ์ ยา ที่เหมาจ่าย | ได้ | BND01 | มีแล้ว | ✔ มีแล้ว |
| 7 | รายการผิดหมวด | ได้ | **INC01** | 364 รายการ (Epoetin alfa 363) | ใหม่ |
| 8 | ไม่มีวิธีใช้ยา | ได้ | R24 | มีแล้ว | ✔ มีแล้ว |
| 9 | เบิกหมวด 2 ไม่ตรงข้อบ่งชี้ | ได้บางส่วน | Q04 + **IND02** | 19 visit มีหมวด 2 | ต่อยอด (ต้องมีตารางข้อบ่งชี้) |
| 10 | แก้ ICD-10/ICD-9 ให้ตรงเวชระเบียน | ไม่ได้ (ต้องคนดู) | — | — | ช่วยได้ด้วย ICD9 / DX01 |
| 11 | ค่าหัตถการให้ตรงเวชระเบียน | ไม่ได้ | — | — | ช่วยได้ด้วย ICD9 |
| 12 | ค่ารักษาไม่ตรงเวชระเบียน | ไม่ได้ | — | — | ช่วยได้ด้วย LAB01 |
| 13 | เสี่ยงไม่เข้าเกณฑ์ ข้อมูลสนับสนุนน้อย | ไม่ได้ | — | — | — |
| 14 | บริการเบิกไม่ได้ | ได้ | PAY01 | 214 รายการ / 15 visit | ✔ มีแล้ว |
| 15 | บันทึกเป็นบริการที่เบิกจ่ายตรงไม่ได้ | ได้ | PAY01 + **ZERO01** | 680 รายการราคา 0 | ต่อยอด |
| 16 | บันทึกค่ารักษาไม่ครบถ้วน | ได้บางส่วน | **DX01** | 17 visit ไม่มี PDX | ใหม่ |
| 17 | องค์ประกอบค่ารักษาไม่ถูกต้อง | ได้บางส่วน | DX01 / ICD9 / R24 / ORD01 | — | รวมกฏเดิม |
| 18 | รายการเดียวกันซ้ำซ้อน | ได้ | **DUP01** | 232 ชุด | ใหม่ |
| 19 | ERROR รูด EDC | ได้ | **EDC01** | ตาราง `ktb_edc_transaction` มีข้อมูล | ใหม่ |
| 20 | ตรวจสอบเกณฑ์ refer | ได้บางส่วน | **REF01** | ตาราง `referin` | ใหม่ (สิทธิ UC/ปกส.) |
| 21 | อุทธรณ์ | ไม่ได้ | — | — | งานธุรการ |
| 22 | ส่งไฟล์จัดทำ PSG | ได้ | **PSG01** | — | ต่อจาก P02/P05 |
| 23 | บันทึกไม่สอดคล้องระเบียบ | (หัวข้อรวม) | BND01 / OR177 / PAY01 / ORD01 | — | รวมกฏเดิม |
| 24 | ไม่มี ICD-9 | ได้ | **ICD9** | 63 visit | ใหม่ |
| 25 | ค่ารักษาไม่เหมาะสมกับทรัพยากร/ไม่พบที่มา | ได้บางส่วน | **ZERO01**, LAB02 | 680 รายการราคา 0 | ใหม่ |

**ใหม่ที่แนะนำให้ทำก่อน (ทำได้ทันที ข้อมูลครบ):** INC01 → ICD9 → EXC01 → DUP01 → EDC01 → LAB02/ZERO01 → DX01
**ต้องได้ข้อมูลเพิ่มก่อน:** SVC01 (วันหยุดราชการ), OR177 (บัญชี ว.177), IND02 (ข้อบ่งชี้หมวด 2), REF01 (เกณฑ์ refer), PSG01 (เงื่อนไขส่งไฟล์)

---

## 2. Logic + SQL รายกฏ

### INC01 — รายการผิดหมวด (#7)
**Logic:** หมวดค่าใช้จ่ายของรายการที่บันทึก (`opitemrece.income`) ไม่ตรงกับหมวดในทะเบียน (`drugitems/nondrugitems.income`) → ERROR
**พบ:** Epoetin alfa (eposis) (ข้าราชการ) บันทึกเป็น 17 ยานอกบัญชี แต่ทะเบียนเป็น 03 ยาในบัญชี — 363 รายการ, การฉีดยา IM 11↔12 — 1 รายการ
```sql
SELECT oi.vn, COALESCE(n.name, d.name) AS name,
       oi.income AS rec_income, COALESCE(n.income, d.income) AS master_income
BASE
LEFT JOIN nondrugitems n ON n.icode = oi.icode
LEFT JOIN drugitems    d ON d.icode = oi.icode
  AND oi.paidst = '02'
  AND COALESCE(n.income, d.income) IS NOT NULL
  AND oi.income <> COALESCE(n.income, d.income)
```
**ข้อความ:** "{name} บันทึกเป็นหมวด {rec} แต่ทะเบียนเป็นหมวด {master} — ไฟล์ส่งเบิกจะลงผิดหมวด (BillMu)"
> ต้องยืนยันกับเภสัช: Epoetin ของสิทธิข้าราชการตั้งใจให้เป็น 17 หรือไม่ ถ้าใช่ ต้องแก้ทะเบียนแทน

### ICD9 — มีค่าหัตถการแต่ไม่มีรหัส ICD-9 (#24, #11, #17)
**Logic:** visit มีรายการหมวด 11 (หัตถการ) ที่เบิก แต่ใน visit ไม่มีรหัสหัตถการเลย (ทั้ง `doctor_operation` และรหัสตัวเลขใน `ovstdiag`) → WARNING
ถ้าทะเบียนรายการมี `nondrugitems.icd9cm` ให้แนะนำรหัสนั้น
**พบ:** 63 visit — Sinuscope 32, วัดความดันลูกตา 15, Micro-otoscope 10, Hemodialysis 3
```sql
SELECT oi.vn, n.name, NULLIF(TRIM(n.icd9cm), '') AS suggest_icd9
BASE
JOIN nondrugitems n ON n.icode = oi.icode
  AND oi.paidst = '02' AND oi.income = '11'
  AND NOT EXISTS (SELECT 1 FROM doctor_operation x WHERE x.vn = oi.vn)
  AND NOT EXISTS (SELECT 1 FROM ovstdiag x WHERE x.vn = oi.vn AND x.icd10 ~ '^[0-9]')
```
> MySQL ใช้ `x.icd10 REGEXP '^[0-9]'` แทน `~`

### EXC01 — ค่าส่วนเกินแสดงไม่ถูกต้อง (#5)
**Logic** (ใช้ตัวจับชื่อ `EXCESS_MARK_RE` เดียวกับเมนูแก้ CIPN):
1. แถวส่วนเกินต้องเป็น **03 ชำระเองเบิกไม่ได้** ถ้าเป็น 02 → ERROR
2. แถวส่วนเกินต้องมี **รายการหลัก** (ชื่อเดียวกันเมื่อตัด `[ชำระส่วนเกิน]` / `[ชำระเงิน-ส่วนเกิน]` / `[ชำระเอง/ส่วนเกิน]` / `ชำระส่วนเกิน-` ออก) ใน visit เดียวกัน และรายการหลักต้องเป็น 02 → ไม่มี = WARNING
3. ถ้ามีรายการหลักแต่ไม่มีแถวส่วนเกิน ทั้งที่ราคาทะเบียนเกินเพดาน (`nondrugitems.sks_coverage_price` หรือ `max_price`) → WARNING
**พบ:** แถวส่วนเกิน 1,438 แถว / 1,369 visit (ทุกแถวเป็น 03 ถูกต้อง) ชื่อหลายรูปแบบ เช่น นวดประคบ 886, ฝังเข็ม 334, Audiogram 30, Calcium 28
```sql
SELECT oi.vn, oi.icode, n.name, oi.paidst, oi.qty, oi.sum_price,
       n.sks_coverage_price, n.max_price
BASE
JOIN nondrugitems n ON n.icode = oi.icode
-- Python: แยกแถวที่ชื่อมี "ส่วนเกิน" -> normalize ชื่อ -> จับคู่กับแถวหลักใน vn เดียวกัน
```
> ต้องยืนยันกับการเงิน: เพดานราคาเก็บไว้ที่คอลัมน์ไหน (`sks_coverage_price` / `max_price` / ตารางอื่น)

### DUP01 — รายการเดียวกันซ้ำซ้อน (#18, #3)
**Logic:** icode เดียวกัน วันเดียวกัน ใน visit เดียวกัน บันทึกมากกว่า 1 แถว (ไม่นับยา) → WARNING
- lab / x-ray ซ้ำ → **ERROR** (มักเกิดจาก remed lab)
- หัตถการที่ทำได้หลายข้าง/หลายครั้ง (ขยายม่านตา, ฉีดยา, ฉีดเข้าข้อ) → INFO หรือข้าม (ต้องได้รายชื่อยกเว้น)
**พบ:** 232 ชุด — ขยายม่านตา 145, BUN 47, ฉีดยา IV 10, Xray Other 8, Creatinine 2
```sql
SELECT oi.vn, oi.icode, n.name, oi.income, oi.rxdate,
       COUNT(*) AS n_rows, SUM(oi.qty) AS total_qty
BASE
JOIN nondrugitems n ON n.icode = oi.icode
  AND oi.paidst = '02' AND oi.income NOT IN ('03','04','17')
GROUP BY oi.vn, oi.icode, n.name, oi.income, oi.rxdate
HAVING COUNT(*) > 1
```

### EDC01 — ERROR รูด EDC (#19)
**ตารางที่มี:** `ktb_edc_transaction` (vn, hn, approval_code, amount, card_no, transaction_date, response_message)
**Logic:**
1. **A04 ยอดไม่ตรง:** `SUM(amount)` ของรายการ EDC ที่อนุมัติ ≠ ยอดเบิกของ visit (`SUM(sum_price) WHERE paidst='02'`) → ERROR
2. **A03 เลขบัตรไม่ตรง:** `card_no` (ถ้าเป็นเลข 13 หลัก) ≠ `patient.cid` → ERROR
3. **A06 approval code ซ้ำ:** approval_code เดียวกันใช้กับ visit อื่น → ERROR
4. **ไม่ได้รูด:** สิทธิเบิกจ่ายตรง (EDC) มีรายการเบิก แต่ไม่มีรายการ EDC → WARNING
```sql
-- ยอด EDC เทียบยอดเบิก
SELECT o.vn, o.hn, pt.cid,
       (SELECT SUM(x.sum_price) FROM opitemrece x WHERE x.vn = o.vn AND x.paidst = '02') AS claim_amt,
       e.approval_code, e.amount AS edc_amt, e.card_no, e.response_message
FROM ovst o
JOIN pttype p   ON p.pttype = o.pttype
JOIN patient pt ON pt.hn = o.hn
LEFT JOIN ktb_edc_transaction e ON e.vn = o.vn
WHERE o.vn IN :vns AND p.hipdata_code IN ('OFC','LGO')

-- approval code ซ้ำหลาย visit
SELECT approval_code, COUNT(DISTINCT vn) FROM ktb_edc_transaction
WHERE approval_code IN :codes GROUP BY approval_code HAVING COUNT(DISTINCT vn) > 1
```
> ต้องตรวจก่อน: `response_message` ค่าไหนคือ "อนุมัติ", `card_no` เก็บเลขบัตรเต็มหรือ mask, ยอด EDC รวมยาด้วยหรือไม่ (ตัวอย่างในแบบประสาน: "จำนวนเงิน 493 บาท App Code …")

### LAB02 / ZERO01 — ราคา Lab ผิด / ราคาไม่เหมาะสม (#1, #15, #25)
**Logic:**
- **LAB02:** lab (income 07) ที่เบิก ราคาต่อหน่วยที่บันทึก ≠ ราคาทะเบียน (`price` / `price2` / `price3` ตาม `pttype.price_type`) → WARNING
- **ZERO01:** รายการที่เบิก (02) แต่ราคา = 0 → WARNING "ส่งเบิก 0 บาท / ราคาไม่มีที่มา"
**พบ:** 731 รายการ / 155 visit ส่วนใหญ่เป็น **lab ชุดตรวจสุขภาพที่บันทึกราคา 0 แต่ทะเบียนตั้งราคา 50–90 บาท** (CBC, UA, BUN, ALP ฯลฯ) — ตรงกับ ZERO01 680 รายการ
```sql
SELECT oi.vn, n.name, oi.unitprice, oi.qty, oi.sum_price,
       n.price, n.price2, n.price3, p.price_type
BASE
JOIN nondrugitems n ON n.icode = oi.icode
  AND oi.paidst = '02'
  AND (  oi.sum_price <= 0
      OR (oi.income = '07'
          AND ABS(oi.unitprice - CASE p.price_type WHEN 2 THEN n.price2 WHEN 3 THEN n.price3 ELSE n.price END) > 0.01))
```
> ต้องยืนยันกับการเงิน: ชุดตรวจสุขภาพที่ราคา 0 เป็นแพ็กเกจที่ตั้งใจ (คิดราคารวมที่รายการอื่น) หรือบันทึกผิด

### SVC01 — บันทึกรายการ 55020 ผิด (#2)
รายการในทะเบียน: `3000508` ค่าบริการทั่วไปผู้ป่วยนอก ในเวลาราชการ (55020), `3000509` นอกเวลาราชการ (55021), `3008896` (จนท.ปกส.รามา), `3003556` [เบิกไม่ได้]
**Logic:**
1. ใช้รหัส **ในเวลา (55020)** ในวันเสาร์-อาทิตย์/วันหยุดราชการ หรือหลัง 16:30 → ERROR (ควรเป็น 55021)
2. ใช้รหัส **นอกเวลา (55021)** ในวันทำการ 08:30–16:30 → WARNING
3. visit มี 55020/55021 มากกว่า 1 (รวม qty) → ERROR
4. คิด 55020 แต่ไม่ได้พบแพทย์ (`ovst.doctor` ว่าง) → WARNING (พบ 2 visit)
5. (เดิม T33) สิทธิ OFC ที่ 55020 ไม่ได้เป็นลูกหนี้สิทธิ
```sql
SELECT oi.vn, oi.icode, n.name, oi.qty, o.vstdate, o.vsttime, oi.rxtime, o.doctor
BASE
JOIN nondrugitems n ON n.icode = oi.icode
  AND oi.icode IN ('3000508','3000509','3008896')
```
> **ข้อควรระวัง:** `ovst.vsttime` เป็นเวลาลงทะเบียน — พบ 849 visit ที่ลงทะเบียน 07:xx แล้วใช้รหัสในเวลา ซึ่งถูกต้อง จึงควรใช้ `oi.rxtime` (เวลาบันทึกรายการ) และต้องมีตารางวันหยุดราชการ (HOSxP `holiday` หรือให้ IT ระบุ)

### LAB01 — รายการเบิกไม่ตรงตามจริง (#3, #12)
**Logic:** lab ที่คิดเงินแต่ไม่ได้รับสิ่งส่งตรวจ (`lab_head.receive_date` ว่าง) และ visit ผ่านไปเกิน 1 วัน → WARNING
(ตัวอย่างในแบบประสาน: "สั่ง lab แต่ไม่ได้ส่งตรวจ… แพทย์กด Remed Lab จากครั้งก่อน")
```sql
SELECT h.vn, h.lab_order_number, li.lab_items_name
FROM lab_head h
JOIN lab_order lo ON lo.lab_order_number = h.lab_order_number
JOIN lab_items li ON li.lab_items_code = lo.lab_items_code
WHERE h.vn IN :vns
  AND h.receive_date IS NULL
  AND h.order_date < CURRENT_DATE
  AND EXISTS (SELECT 1 FROM opitemrece oi WHERE oi.vn = h.vn AND oi.icode = li.icode AND oi.paidst = '02')
```
> ต้องทดสอบก่อนว่า `receive_date` ถูกบันทึกจริงทุกห้อง lab

### DX01 — บันทึกค่ารักษาไม่ครบถ้วน / องค์ประกอบไม่ครบ (#16, #17)
**Logic:** visit ที่มีรายการเบิก แต่ไม่มี PDX (`ovstdiag.diagtype='1'`) → ERROR · ไม่มีแพทย์ผู้ตรวจ → ERROR
**พบ:** 17 visit ไม่มี PDX
```sql
SELECT o.vn,
       EXISTS (SELECT 1 FROM ovstdiag x WHERE x.vn = o.vn AND x.diagtype = '1') AS has_pdx,
       COALESCE(TRIM(o.doctor), '') <> '' AS has_doctor
FROM ovst o JOIN pttype p ON p.pttype = o.pttype
WHERE o.vn IN :vns AND p.hipdata_code IN ('OFC','LGO')
  AND EXISTS (SELECT 1 FROM opitemrece x WHERE x.vn = o.vn AND x.paidst = '02')
```
> กฏพื้นฐาน (PDX ว่าง) มีใน pre-screen เดิมแล้วบางส่วน — DX01 จะผูกกับ "มีรายการเบิก" เพื่อลดการเตือนของ visit ที่ไม่ได้ส่งเบิก

### OR177 — ค่าหัตถการผ่าตัดไม่สอดคล้อง ว.177 (#4, #23)
**Logic:** visit/วันที่มีหัตถการห้องผ่าตัด (ชื่อมี `(OR)`, `Major/OR`, `Minor/OR` หรืออยู่ในบัญชีหัตถการ OR) แล้วมีรายการเบิกแยกที่ ว.177 กำหนดให้รวมในค่าหัตถการ เช่น NSS (For irrigate), เวชภัณฑ์พื้นฐาน OR, ยาพื้นฐานในหัตถการ → WARNING
```sql
SELECT oi.vn, n.name AS proc_name, b.icode, nb.name AS item_name, b.income
BASE
JOIN nondrugitems n ON n.icode = oi.icode
JOIN opitemrece b   ON b.vn = oi.vn AND b.paidst = '02' AND b.icode <> oi.icode
LEFT JOIN nondrugitems nb ON nb.icode = b.icode
LEFT JOIN drugitems    db ON db.icode = b.icode
  AND oi.paidst = '02' AND oi.income = '11'
  AND (n.name ILIKE '%(OR)%' OR n.name ILIKE '%/OR%' OR oi.icode IN :or_procs)
  AND (b.icode IN :w177_items OR COALESCE(nb.name, db.name) ILIKE '%irrigat%')
```
> **ต้องได้จากการเงิน/OR:** บัญชี `or_procs` (หัตถการ OR) และ `w177_items` (ยา/เวชภัณฑ์ที่รวมในค่าหัตถการ) — เก็บเป็นตารางในระบบให้แก้ได้จากหน้าเว็บ

### IND02 — เบิกหมวด 2 ไม่ตรงข้อบ่งชี้ (#9)
**Logic:** รายการหมวด 2 (income 02) ที่มีในตาราง "ข้อบ่งชี้" (icode → กลุ่ม ICD-10 ที่อนุญาต) แต่ visit ไม่มีรหัสโรคในกลุ่มนั้น → WARNING
ตัวอย่างจากแบบประสาน: Knee/Ankle support ต้องมี Dx ข้อเท้า/เอ็น/กระดูกฝ่าเท้าอักเสบ, ชุดถุงให้อาหาร ต้องให้อาหารทางสายโดยตรง
```sql
SELECT oi.vn, n.name, r.allowed_icd10_prefixes,
       ARRAY(SELECT x.icd10 FROM ovstdiag x WHERE x.vn = oi.vn) AS dx
BASE
JOIN nondrugitems n ON n.icode = oi.icode
JOIN indication_rules r ON r.icode = oi.icode      -- ตารางใหม่ในระบบ (ไม่ใช่ HOSxP)
  AND oi.paidst = '02' AND oi.income = '02'
-- Python: ไม่มี dx ใดขึ้นต้นด้วย prefix ที่อนุญาต -> เตือน
```
**พบ:** 19 visit มีหมวด 2 ใน OPD (ต้องทำตารางข้อบ่งชี้ก่อน)

### REF01 — ตรวจสอบเกณฑ์ refer (#20)
**Logic** (ใช้กับสิทธิที่ต้องมีใบส่งตัว เช่น UC / ปกส. ที่ `ovst.hospmain` ≠ 40922):
1. ไม่มี `referin` ของ visit → ERROR
2. `referin.expire_date` < วันรับบริการ → ERROR (ใบส่งตัวหมดอายุ)
3. `referin.icd10` / `pre_diagnosis` ไม่ตรงกลุ่มกับ PDX → WARNING
```sql
SELECT o.vn, o.hospmain, r.refer_hospcode, r.expire_date, r.icd10 AS refer_dx,
       (SELECT x.icd10 FROM ovstdiag x WHERE x.vn = o.vn AND x.diagtype = '1' LIMIT 1) AS pdx
FROM ovst o
JOIN pttype p ON p.pttype = o.pttype
LEFT JOIN referin r ON r.vn = o.vn
WHERE o.vn IN :vns
  AND p.hipdata_code IN ('UCS','SSS')
  AND COALESCE(o.hospmain, '') NOT IN ('', '40922')
```
> ต้องได้เกณฑ์จากศูนย์สิทธิ์: สิทธิไหนต้องมี refer, ใช้กับทุกคลินิกหรือเฉพาะบางกรณี (ฉุกเฉินได้รับยกเว้น)

### PSG01 — ส่งไฟล์จัดทำ PSG (#22)
**Logic:** visit มีรายการ PSG (`3008897` ตรวจการนอนหลับ, `3008899` Polysomnogram) ที่เบิก →
- ใช้กฏ P02/P05 เดิม (เลขอนุมัติ / แพทย์ ว29312)
- เพิ่มแจ้ง INFO "ต้องส่งไฟล์ PSG ให้ IT จัดทำ (เมนูแก้ CPAP/PSG)" พร้อมสถานะว่ามีประวัติแก้ไฟล์ใน `fix_history` แล้วหรือยัง
```sql
SELECT oi.vn, n.name
BASE
JOIN nondrugitems n ON n.icode = oi.icode
  AND oi.paidst = '02' AND oi.icode IN ('3008897','3008899')
```

---

## 3. หัวข้อที่ต้องใช้คนตรวจ (ระบบช่วยชี้เป้าได้)
| # | หัวข้อ | ระบบช่วยได้ |
|---|---|---|
| 10 | ICD-10/ICD-9 ให้ตรงเวชระเบียน | ICD9 (ไม่มีรหัสหัตถการ), DX01 (ไม่มี PDX), ICD เดิม (รหัสไม่ถูกต้อง/U-code) |
| 11 | ค่าหัตถการให้ตรงเวชระเบียน | ICD9 + ORD01 (ผู้สั่งไม่ใช่แพทย์) |
| 12 | ค่ารักษาไม่ตรงเวชระเบียน | LAB01 (lab ไม่ได้ส่งตรวจ), DUP01 |
| 13 | ข้อมูลสนับสนุนน้อย | IND02 (ข้อบ่งชี้) — ที่เหลือต้องอ่านเวชระเบียน |
| 21 | อุทธรณ์ | ไม่เกี่ยวกับ pre-screen (ทำหลังติด C) |

## 4. ข้อมูลที่ต้องขอก่อนลงมือ
1. **เภสัช:** Epoetin alfa สิทธิข้าราชการ ควรเป็นหมวด 17 หรือ 03 (INC01)
2. **การเงิน:** lab ชุดตรวจสุขภาพราคา 0 ตั้งใจหรือไม่ (LAB02/ZERO01) · เพดานราคาส่วนเกินเก็บที่ไหน (EXC01)
3. **IT:** ตารางวันหยุดราชการ (SVC01) · ความหมายของ `ktb_edc_transaction.response_message`/`card_no` (EDC01) · `lab_head.receive_date` ใช้จริงหรือไม่ (LAB01)
4. **OR/การเงิน:** บัญชีหัตถการ OR + รายการ ว.177 (OR177)
5. **ศูนย์สิทธิ์:** ตารางข้อบ่งชี้หมวด 2 (IND02) · เกณฑ์ refer (REF01) · รายการหัตถการที่ซ้ำได้ (DUP01)
