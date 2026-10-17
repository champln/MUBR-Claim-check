# ข้อเสนอกฏตรวจใหม่ จากแบบประสานศูนย์สิทธิประโยชน์ ปีงบ 2569

> สถานะ: **ร่างเพื่อพิจารณา ยังไม่ได้เขียนลงระบบ**
> ที่มา: `แบบประสานศูนย์สิทธิประโยชน์ ปีงบ 2569 - Sheet1.csv` (925 รายการ)
> ตัวเลข "พบใน HOSxP" มาจากการรัน query ด้านล่างกับฐานจริง ย้อนหลัง 30 วัน
> เฉพาะสิทธิ กบก./อปท. (`pttype.hipdata_code IN ('OFC','LGO')`) และนับเป็นจำนวนเท่านั้น ไม่ได้ดึงข้อมูลผู้ป่วย

---

## 1. สรุปภาพรวม

| # | รหัสกฏ | เรื่อง | ในแบบประสาน | พบใน HOSxP (30 วัน) | ตรวจที่ | ระดับ | ความพร้อม |
|---|---|---|---|---|---|---|---|
| 1 | **BND01** | เบิกเวชภัณฑ์ที่เหมารวมในค่าหัตถการแล้ว | 84+ | **82 visit / 142 รายการ** | Live | WARNING | พร้อม (ใช้ชื่อรายการ) + รอตารางจากการเงิน |
| 2 | **ORD01** | ผู้สั่งหัตถการ/ค่าบริการไม่ใช่แพทย์ (เสี่ยง T84/S48) | 62 (+34 แก้ผู้สั่ง) | 84 visit / 110 รายการ | Live | WARNING | พร้อม |
| 3 | **V02** | Lab COVID ไม่ระบุรหัสเงื่อนไข COVID | 38 (43+27 VN) | 25 visit | Live + ไฟล์ | ERROR | พร้อม |
| 4 | **PAY01** | รายการที่ทะเบียนตั้ง "เบิกไม่ได้ (03)" แต่คิดเป็นลูกหนี้สิทธิ (02) | 41 | 14 รายการ | Live | ERROR | พร้อม |
| 5 | **C05** | 2 visit คนเดียวกัน วัน-เวลา (นาที) เดียวกัน | 2 | 74 คู่ | Live + ไฟล์ | WARNING | พร้อม (ต้องเฝ้าดู noise) |
| 6 | **Q04** | อวัยวะเทียม/อุปกรณ์หมวด 2 ใน OPD | 2 | 25 visit | Live + ไฟล์ | WARNING | พร้อม |
| 7 | **S48** | แพทย์ผู้ตรวจไม่มีเลข ว. | 1 (+แก้ผู้สั่ง) | 76 visit (*ต้องตรวจรูปแบบ licenseno*) | Live + ไฟล์ | ERROR | ต้องยืนยันรูปแบบเลข ว. |
| 8 | **G06** | ยาที่เบิกได้แต่ไม่มี TMT | 7 (G06/07/09) | 73 รายการยา | Live | WARNING | พร้อม |
| 9 | **L01** | Lab ที่ไม่มี TMLT | 5 | 126 รายการ lab | Live | WARNING | พร้อม |
| 10 | **CHK01** | รายการ "(ตรวจสุขภาพ)" ใน visit รักษา | 9 | 0 (เคสจริงอยู่ใน PAY01 แล้ว) | Live | WARNING | รวมกับ PAY01 |
| 11 | **LAB01** | สั่ง lab แต่ไม่มีผล/ไม่ได้ส่งตรวจ | ~15 | 10 visit (เฉพาะยังไม่ยืนยันผล) | Live | INFO | noise สูง ทำทีหลัง |

**ลำดับที่แนะนำ:** BND01 → ORD01 → V02 → PAY01 → Q04 → C05 → G06/L01 → S48 (หลังยืนยันรูปแบบ) → LAB01

**ทำเป็นกฏอัตโนมัติไม่ได้ (ต้องใช้คน)**
- A03–A05 EDC (22): ต้องใช้ข้อมูลจากเครื่อง EDC
- การทบทวนรหัสโรค/หัตถการ (118)
- ข้อบ่งชี้อุปกรณ์ เช่น knee support (29)
- รามา HR (37)
- ขั้นตอนเปิด/ปิดค่าใช้จ่าย

**มีกฏอยู่แล้ว:** R24, T42, S19/S41, T33, G04, CPAP/PSG, FEE001–004, ClaimCat ผู้ป่วยใน

---

## 2. โครงที่ใช้ร่วมกัน

ทุกกฏ Live จะเพิ่มเข้าไปใน `_file_rules()` ของ `backend/services/hosxp_live_source.py` ตามแบบเดิม ดังนี้
- ใช้ `add(vn, _issue(...))`
- ห่อแต่ละกฏด้วย `try/except` แล้วเรียก `_rollback(conn)` และ `skipped.append(...)`
- กฏที่ต้องใช้ตาราง/คอลัมน์ใหม่ (`oapp`, `lab_head`, `lab_order`, `lab_items`, `provider_type`) ต้องเพิ่มใน `LIVE_REQUIREMENTS` ด้วย เพื่อให้หน้า readiness ตรวจสิทธิ์ SELECT

```python
# ค่าคงที่ที่ใช้ร่วมกัน (เพิ่มบนหัวไฟล์)
FEE_ICODES = ("3008561", "3008684", "3008013")        # ค่าธรรมเนียมโรงพยาบาล ในเวลา/นอกเวลา
PHYSICIAN_TYPES = ("01", "02")                          # provider_type: แพทย์, ทันตแพทย์
CLAIMABLE = "02"                                        # paidst ลูกหนี้สิทธิ
NOT_CLAIMABLE = "03"                                    # paidst ชำระเองเบิกไม่ได้
```

> หมายเหตุ: ใน query ด้านล่าง `:vns` คือรายการ VN ที่ Live ดึงมาในรอบนั้น (`bindparam("vns", expanding=True)`)
> ส่วน query ตรวจย้อนหลังใช้ `o.vstdate >= CURRENT_DATE - 30` แทน

---

## 3. รายละเอียดแต่ละกฏ

### BND01 — เบิกเวชภัณฑ์ที่เหมารวมอยู่ในค่าหัตถการแล้ว
**ที่มา:** มติ คกก.บริหาร ศกพ. 9 เม.ย. 69, ว.177 (NSS irrigate)
**ตัวอย่างในแบบประสาน:** "เบิก IV catheter ที่รวมในค่าการให้สารน้ำทางหลอดเลือดดำ", "ลบรายการเวชภัณฑ์สิ้นเปลืองพื้นฐาน", "ไม่เบิกแยก NSS (For irrigate) จากหัตถการผ่าตัด"

**สิ่งที่พบ:** ทะเบียน `nondrugitems` ระบุของที่เหมารวมไว้ในชื่อรายการเองอยู่แล้ว 99 รายการ เช่น
- `การให้สารน้ำทางหลอดเลือดดำ [ผู้ป่วยนอก/ฉุกเฉิน ,รวม IV set, T-way ,extension,IV catheter]`
- `การทำแผลเปิดขนาดใหญ่ [มากกว่า 15 นาที รวมเเพิ่ม Top Dressing 8-12 ชิ้น]`
- `การฉีดยา IM [ผู้ป่วยนอก/ฉุกเฉิน,รวมเข็ม และSyring)`
- `การสวนปัสสาวะทิ้ง(รวมสายสวนและน้ำยา)` *(เทียบกับ "คาสาย (ไม่รวมสายสวนและถุง)" ที่เบิกแยกได้)*

ใน 30 วัน มี **82 visit** ที่มีหัตถการแบบ "รวม…" และยังมีเวชภัณฑ์ (income 05/10) เบิกแยกด้วย
ของที่พบบ่อยคือ Tensofix 51, TOP GAUZE 32, Bactigras 22, Medicut 11 ซึ่งตรงกับในแบบประสาน

**Logic**
1. หาหัตถการใน visit (income 11/12, paidst 02) ที่ชื่อมีวงเล็บและมีคำว่า "รวม" แต่ไม่ใช่ "ไม่รวม"
2. หาเวชภัณฑ์ (income 05/10, paidst 02) ใน visit เดียวกัน
3. ทำได้ 2 ระดับ:
   - **ระดับ A (ใช้ได้ทันที):** แตกคำในวงเล็บ "รวม …" เป็นคำสำคัญ (IV set, extension, IV catheter→Medicut, Top Dressing→gauze/Tensofix ฯลฯ) ถ้าชื่อเวชภัณฑ์ตรงคำใดคำหนึ่ง → WARNING
   - **ระดับ B (แม่นที่สุด):** ใช้ตารางคู่ `หัตถการ icode → เวชภัณฑ์ icode/คำค้น` ที่การเงินยืนยันตามมติ (เก็บในตาราง SQLite `bundle_rules` และแก้ได้จากหน้าเว็บ)

**Query (Live)**
```sql
SELECT a.vn,
       na.icode  AS proc_icode, na.name AS proc_name,
       nb.icode  AS item_icode, nb.name AS item_name, b.qty, b.sum_price
FROM opitemrece a
JOIN nondrugitems na ON na.icode = a.icode
JOIN opitemrece b    ON b.vn = a.vn AND b.icode <> a.icode
JOIN nondrugitems nb ON nb.icode = b.icode
WHERE a.vn IN :vns
  AND (a.an IS NULL OR a.an = '')
  AND a.paidst = '02' AND a.income IN ('11','12')
  AND na.name ~ '[\[(\-][^\])]*รวม'          -- มีวงเล็บ/ขีด แล้วตามด้วย "รวม"
  AND b.paidst = '02' AND b.income IN ('05','10')
```

**Code**
```python
# คำในชื่อหัตถการ -> คำที่ใช้จับชื่อเวชภัณฑ์ (ระดับ A) — เริ่มจากเคสที่พบจริงในแบบประสาน
BUNDLE_KEYWORDS = {
    "iv catheter": ["medicut", "iv catheter", "intracath", "jelco"],
    "iv set":      ["iv set", "infusion set"],
    "extension":   ["extension"],
    "t-way":       ["t-way", "3-way", "three way"],
    "top dressing": ["top gauze", "gauze", "tensofix", "easifix", "bactigras", "top dressing"],
    "เซ็ท":        ["set ทำแผล", "ชุดทำแผล"],
    "น้ำยา":       ["nss", "betadine", "povidone"],
    "สายสวน":      ["foley", "nelaton"],
    "เข็ม":        ["needle", "เข็ม"],
    "syring":      ["syringe", "syring"],
    "ชุดเย็บ":     ["ชุดเย็บ"],
    "ไหมเย็บ":     ["nylon", "silk", "vicryl", "ไหม"],
}
_INCLUDE_RE = re.compile(r"[\[(\-]([^\])]*?)(?<!ไม่)รวม([^\])]*)")

def _bundled_keywords(proc_name: str) -> set[str]:
    """คืนคำค้นเวชภัณฑ์ที่หัตถการนี้รวมไว้ — ข้ามส่วนที่เป็น 'ไม่รวม'"""
    out = set()
    for m in _INCLUDE_RE.finditer(proc_name.lower()):
        part = m.group(2)
        for key, words in BUNDLE_KEYWORDS.items():
            if key in part:
                out.update(words)
    return out

# ใน _file_rules
try:
    rows = conn.execute(text(BND01_SQL).bindparams(bindparam("vns", expanding=True)),
                        {"vns": vns}).mappings().all()
    for r in rows:
        kws = _bundled_keywords(str(r["proc_name"] or ""))
        item = str(r["item_name"] or "").lower()
        if kws and any(k in item for k in kws):
            add(r["vn"], _issue(
                "BND01", "AMOUNT", "opitemrece",
                f"{r['item_name'].strip()} เหมารวมอยู่ใน {r['proc_name'].strip()} แล้ว "
                "— ไม่เบิกแยก (มติ คกก.บริหาร ศกพ. 9 เม.ย. 69)",
                severity="WARNING", current_value=f"{r['qty']} × {r['sum_price']}"))
except Exception:
    _rollback(conn); skipped.append("BND01 เวชภัณฑ์เหมารวมในหัตถการ")
```

**ต้องขอจากการเงิน:** รายการหัตถการ OR ที่ "เบิกยาและเวชภัณฑ์พื้นฐานรวมในค่าหัตถการผ่าตัด" ซึ่งไม่ได้เขียน "รวม" ไว้ในชื่อ เช่น `(Major/OR) Excisional debridement` ต้องใช้ตารางระดับ B

---

### ORD01 — ผู้สั่งหัตถการ/ค่าบริการไม่ใช่แพทย์
**ที่มา:**
- T84 (51) ตาม ว.435: สกส. ตรวจว่า "ได้พบแพทย์หรือไม่" ถ้าในใบมีแต่หัตถการ และผู้สั่งไม่ใช่แพทย์ ค่าบริการ 50 บาทจะถูกเรียกคืน
- S48: "แก้ไขชื่อผู้สั่งรายการค่ารักษาพยาบาลเป็นแพทย์ผู้ตรวจ"
- **วิธีที่แก้จริงในแบบประสาน 34 ครั้ง** คือแก้ชื่อผู้สั่งหัตถการเป็นแพทย์ผู้ตรวจ

**พบใน 30 วัน:**
- หัตถการ (income 11) ที่ผู้สั่งไม่ใช่แพทย์/ทันตแพทย์ ทั้งที่แพทย์ผู้ตรวจของ visit เป็นแพทย์: **110 รายการ / 84 visit**
- ผู้สั่งที่พบบ่อย: พยาบาล (03), ผู้สั่งว่าง, ผู้สั่งที่ไม่อยู่ในตาราง doctor

**Logic**
- หัตถการ (income 11, 12 ยกเว้นรายการค่าธรรมเนียม) ที่ paidst 02 ซึ่งผู้สั่ง (`opitemrece.doctor`) ว่าง หรือ provider_type ไม่ใช่ 01/02 → WARNING "แก้ผู้สั่งเป็นแพทย์ผู้ตรวจ"
- ถ้า visit นั้นคิดค่าธรรมเนียม/ค่าบริการ 50 บาทด้วย → ยกระดับเป็น ERROR "เสี่ยง T84"
- **ไม่ตรวจ** income 14 กายภาพ, 15 แผนไทย, 13 ทันตกรรม และยา เพราะมีผู้สั่งเป็นนักกายภาพ/แพทย์แผนไทยได้ตามปกติ (สถิติพบ 08 สั่ง income 15 จำนวน 1,247 รายการ ซึ่งถูกต้อง)

**Query (Live)**
```sql
SELECT oi.vn, n.name AS item_name, oi.income,
       COALESCE(d.name, '') AS orderer_name,
       COALESCE(pt.provider_type_name, CASE WHEN COALESCE(TRIM(oi.doctor),'') = '' THEN 'ไม่ระบุผู้สั่ง'
                                            ELSE 'ไม่พบในทะเบียนแพทย์' END) AS orderer_type,
       e.name AS examiner_name,
       EXISTS (SELECT 1 FROM opitemrece f
               WHERE f.vn = oi.vn AND f.icode IN :fee_icodes AND f.paidst = '02') AS has_fee
FROM opitemrece oi
JOIN ovst o            ON o.vn = oi.vn
JOIN nondrugitems n    ON n.icode = oi.icode
LEFT JOIN doctor d     ON d.code = oi.doctor
LEFT JOIN provider_type pt ON pt.provider_type_code = d.provider_type_code
LEFT JOIN doctor e     ON e.code = o.doctor
WHERE oi.vn IN :vns
  AND (oi.an IS NULL OR oi.an = '')
  AND oi.paidst = '02'
  AND oi.income IN ('11','12')
  AND oi.icode NOT IN :fee_icodes
  AND n.name NOT LIKE 'ค่าบริการทั่วไปผู้ป่วยนอก%'
  AND COALESCE(d.provider_type_code,'') NOT IN ('01','02')
```

**Code**
```python
try:
    rows = conn.execute(text(ORD01_SQL).bindparams(
        bindparam("vns", expanding=True), bindparam("fee_icodes", expanding=True)),
        {"vns": vns, "fee_icodes": list(FEE_ICODES)}).mappings().all()
    for r in rows:
        who = r["orderer_name"] or r["orderer_type"]
        fix = f" — แก้ผู้สั่งเป็นแพทย์ผู้ตรวจ ({r['examiner_name']})" if r["examiner_name"] else ""
        if r["has_fee"]:
            add(r["vn"], _issue("ORD01", "DOCTOR", "opitemrece.doctor",
                f"{r['item_name'].strip()} ผู้สั่งไม่ใช่แพทย์ ({who}) และ visit นี้เก็บค่าบริการ/ค่าธรรมเนียม "
                f"— เสี่ยงติด C T84 (ว.435){fix}", severity="ERROR", current_value=who))
        else:
            add(r["vn"], _issue("ORD01", "DOCTOR", "opitemrece.doctor",
                f"{r['item_name'].strip()} ผู้สั่งไม่ใช่แพทย์ ({who}){fix}",
                severity="WARNING", current_value=who))
except Exception:
    _rollback(conn); skipped.append("ORD01 ผู้สั่งหัตถการ")
```

**คำถาม:** หัตถการที่พยาบาลสั่งเองได้ตามระเบียบ เช่น ฉีดยาตามนัด/ทำแผลตามนัด ควรตรวจหรือไม่? ถ้าไม่ตรวจ ต้องการรายการ icode ยกเว้น

---

### V02 — Lab COVID ไม่ระบุรหัสเงื่อนไข COVID-19
**ที่มา:** V02 รวม 70 VN ใน 2 รอบ (ม.ค. และ ก.พ. 69) ปัจจุบันแก้ด้วยเมนู `/covid19-fix` (ใส่ AuthCode `COV-19` ใน BILLTRAN)
**ใน HOSxP:** มี lab_items 5 รายการ เช่น `COVID Ag Rapid Test (เบิกได้)`, `Flu A/B+COVID 19 Ag Combo test` ใน 30 วันพบ **25 visit** ที่เบิกได้แต่ไม่มี U07 ใน ovstdiag

**Logic (Live):** มี lab COVID ที่ paidst 02 → WARNING "ส่งออกไฟล์แล้วต้องใส่ AuthCode COV-19 (เมนูแก้ COVID-19)"
ถ้าไม่มีรหัสโรค U07.1/U07.2 ด้วย ให้เตือนเพิ่มว่าอาการอาจไม่เข้าเกณฑ์ตามระเบียบ บก. (ตัวอย่างในแบบประสาน: "แก้ไขรายการค่าตรวจหาเชื้อโควิดเป็นชำระเอง เนื่องจากอาการไม่เข้าเกณฑ์")

**Query (Live)**
```sql
SELECT h.vn, li.lab_items_name, oi.paidst,
       EXISTS (SELECT 1 FROM ovstdiag x WHERE x.vn = h.vn AND x.icd10 ILIKE 'U07%') AS has_u07
FROM lab_head h
JOIN lab_order lo ON lo.lab_order_number = h.lab_order_number
JOIN lab_items li ON li.lab_items_code = lo.lab_items_code
LEFT JOIN opitemrece oi ON oi.vn = h.vn AND oi.icode = li.icode
WHERE h.vn IN :vns
  AND li.lab_items_name ILIKE ANY (ARRAY['%covid%','%sars%','%cov-2%'])
  AND li.lab_items_name NOT LIKE '%เบิกไม่ได้%'
  AND COALESCE(oi.paidst,'02') = '02'
```

**Code (ไฟล์ส่งเบิก, เพิ่มใน `c_code_checker.check_c_codes`)**
```python
# BILLTRAN: [1] AuthCode, [4] InvNo | BillItems: [0] InvNo, [5] Desc (ตรวจ index กับ parser เดิมอีกครั้งตอนลงมือ)
COVID_RE = re.compile(r"covid|sars|cov-2", re.I)
covid_inv = {f[0] for f in bill_items if COVID_RE.search(f[5]) and "เบิกไม่ได้" not in f[5]}
for f in billtran:
    if f[4] in covid_inv and f[1].strip().upper() != "COV-19":
        hits.append(f[4])
if hits:
    findings.append(_finding("V02", "Lab COVID ไม่ระบุเงื่อนไข COVID-19",
        "BILLTRAN AuthCode ต้องเป็น COV-19", len(hits), "แก้ COVID-19", "/covid19-fix"))
```

---

### PAY01 — ทะเบียนตั้ง "เบิกไม่ได้" แต่คิดเป็นลูกหนี้สิทธิ
**ที่มา:** 41 เรื่อง "ประเภทการชำระไม่ถูกต้อง" (เช่น Alfacalcidol ก่อน 1 พ.ค. 69 เป็น NED) และ "รายการเบิกได้ซึ่งไม่ตรงกับใบรายละเอียดที่กำหนดเป็นเบิกไม่ได้"

**สิ่งที่พบ:**
- `paidst` ในทะเบียน `drugitems`/`nondrugitems` ส่วนใหญ่**ว่าง** จึงเทียบได้เฉพาะรายการที่ทะเบียนตั้ง `03` ไว้ชัดเจน
- ใน 30 วันพบ **14 รายการ** เช่น `ตรวจสมรรถภาพการได้ยิน(Audiogram)(ตรวจสุขภาพ)` 12 และ `Ishihara Test[ตรวจสุขภาพ ตาบอดสี]` 2 ซึ่งตรงกับเรื่อง "ผูกชุดรายการตรวจสุขภาพในการรักษา" ในแบบประสาน (กฏ **CHK01** จึงรวมไว้ในกฏนี้)

**Logic**
1. paidst ของรายการ = 02 แต่ทะเบียนตั้ง 03 → ERROR
2. หรือชื่อรายการมีคำว่า `เบิกไม่ได้` / `(ตรวจสุขภาพ)` / `[ตรวจสุขภาพ` แต่คิด 02 → ERROR

**Query (Live)**
```sql
SELECT oi.vn, COALESCE(d.name, n.name) AS item_name, oi.paidst,
       COALESCE(NULLIF(TRIM(d.paidst),''), NULLIF(TRIM(n.paidst),'')) AS master_paidst
FROM opitemrece oi
LEFT JOIN drugitems d    ON d.icode = oi.icode
LEFT JOIN nondrugitems n ON n.icode = oi.icode
WHERE oi.vn IN :vns
  AND (oi.an IS NULL OR oi.an = '')
  AND oi.paidst = '02'
  AND (  COALESCE(NULLIF(TRIM(d.paidst),''), NULLIF(TRIM(n.paidst),'')) = '03'
      OR COALESCE(d.name, n.name) LIKE '%เบิกไม่ได้%'
      OR COALESCE(d.name, n.name) ~ '[\[(]\s*ตรวจสุขภาพ' )
```

**Code**
```python
for r in rows:
    why = ("ทะเบียนตั้งเป็นชำระเองเบิกไม่ได้ (03)" if r["master_paidst"] == "03"
           else "เป็นรายการตรวจสุขภาพ/เบิกไม่ได้")
    add(r["vn"], _issue("PAY01", "AMOUNT", "paidst",
        f"{r['item_name'].strip()} คิดเป็นลูกหนี้สิทธิ (02) แต่{why} — ลบแล้วบันทึกใหม่เป็น 03",
        current_value=r["paidst"]))
```

**ต่อยอด:** ยาที่เปลี่ยนสถานะตามประกาศ (เช่น Alfacalcidol เป็นยาในบัญชีตั้งแต่ 1 พ.ค. 69) ทำเป็นตาราง `drug_status_history(icode, from_date, paidst)` แล้วตรวจตามวันที่ visit

---

### C05 — ส่งเบิกซ้ำ คนเดียวกัน วันและเวลาเดียวกัน
**ที่มา:** "ผู้ป่วยเข้ารับบริการในวันและเวลาเดียวกัน จำนวน 2 VN จึงต้องแก้ไขเวลาเข้ารับบริการหลักนาทีให้ต่างกัน"
**พบใน 30 วัน:** 74 คู่ที่ทั้งสอง visit มีรายการเบิก แต่ติด C จริงเพียง 2 ครั้ง จึงตั้งเป็น WARNING ก่อน แล้วดูว่า e-claim เทียบถึงระดับวินาทีหรือไม่

**Query (Live)**
```sql
SELECT o.vn, o.hn, o.vstdate, date_trunc('minute', o.vsttime) AS vmin,
       COUNT(*) OVER (PARTITION BY o.hn, o.vstdate, date_trunc('minute', o.vsttime)) AS same_min
FROM ovst o
WHERE o.vn IN :vns
  AND (o.an IS NULL OR o.an = '')
  AND EXISTS (SELECT 1 FROM opitemrece x WHERE x.vn = o.vn AND x.paidst = '02')
-- Python: เก็บแถวที่ same_min > 1
```
> หมายเหตุ: ถ้าอีก visit อยู่นอกช่วงที่ Live ดึงมา (เช่น คนละสิทธิ) ให้ใช้ subquery กับ `ovst` ทั้งวันแทน `IN :vns`

**Code (ไฟล์ส่งเบิก)**
```python
# BILLTRAN: [2] DTtran (YYYY-MM-DDThh:mm:ss), [12] Pid
seen = defaultdict(list)
for f in billtran:
    seen[(f[12], f[2][:16])].append(f[4])          # ตัดเหลือระดับนาที
dups = [invs for invs in seen.values() if len(invs) > 1]
```
**วิธีแก้:** ขยับเวลาเข้ารับบริการของ visit ที่ 2 ให้ต่างกัน 1 นาที (แก้ใน HOSxP หรือทำเมนูแก้ไฟล์เพิ่ม)

---

### Q04 — อวัยวะเทียม/อุปกรณ์หมวด 2 ในผู้ป่วยนอก
**ที่มา:** "Q04 : เบิกอุปกรณ์อวัยวะเทียม (หมวด 2) ที่ไม่สามารถเบิกในผู้ป่วยนอกได้" (K-wire, สกรู)
**พบใน 30 วัน:** 25 visit ที่มี income 02 แบบ paidst 02 ในผู้ป่วยนอก ส่วนใหญ่อาจเป็นรายการที่เบิกใน OPD ได้ตามระเบียบ (เช่น อุปกรณ์พยุง) จึงตั้งเป็น WARNING

**Logic:** income `02` + paidst 02 + ไม่ใช่ admit → WARNING พร้อมชื่อรายการ ถ้าเป็นรายการที่ใช้ในห้องผ่าตัด (ชื่อมี `(OR)`, `screw`, `สกรู`, `K-wire`, `plate`) ยกระดับเป็น ERROR
**Query (Live)**
```sql
SELECT oi.vn, n.icode, n.name, oi.qty, oi.sum_price
FROM opitemrece oi JOIN nondrugitems n ON n.icode = oi.icode
WHERE oi.vn IN :vns AND (oi.an IS NULL OR oi.an = '')
  AND oi.income = '02' AND oi.paidst = '02'
```
**Code (ไฟล์ส่งเบิก):** BillItems `[2] BillMu == '2'` ในไฟล์ OPD (CSOP) → นับและแสดงรายการ

---

### S48 — แพทย์ผู้ตรวจไม่มีเลข ว.
**ที่มา:** "S48 : ไม่ระบุ ว.แพทย์ ในไฟล์ส่งเบิก"
**พบใน 30 วัน:** 76 visit ที่แพทย์ผู้ตรวจเป็น provider_type 01 แต่ `licenseno` ไม่ขึ้นต้นด้วย "ว"
**ต้องยืนยันก่อน:** HOSxP บางแห่งเก็บเลขใบประกอบเป็นตัวเลขล้วน และระบบใส่ "ว" ตอนส่งออกเอง ต้องเทียบกับ OPServices ฟิลด์ [11] ในไฟล์จริงก่อนว่าว่างหรือไม่

**Logic**
- **Live:** `licenseno` ว่าง → ERROR; ถ้ารูปแบบไม่ตรงกับ `^ว?\.?\s*\d{3,6}$` → WARNING
- **ไฟล์:** OPServices `[11]` ว่าง → ERROR S48 (ตรวจแบบเดียวกับ c_code_checker)

```sql
SELECT o.vn, e.name AS doctor_name, e.licenseno, e.provider_type_code
FROM ovst o LEFT JOIN doctor e ON e.code = o.doctor
WHERE o.vn IN :vns AND COALESCE(TRIM(e.licenseno),'') = ''
```

---

### G06 — ยาที่เบิกได้แต่ไม่มี TMT
**ที่มา:** G06/G07/G09 (7): "ไม่ระบุรหัส TMT ใน Drug ID แต่ระบุใน Drug Catalog" และ "TMT ไม่ตรงกับ Drug Catalog"
**พบใน 30 วัน:** 73 รายการยา (นับซ้ำแค่ครั้งเดียว) ที่เบิกได้แต่ `drugitems.tmt_tp_code` ว่าง

**Logic (Live):** ยา paidst 02 ที่ `tmt_tp_code` ว่าง → WARNING (แจ้งเภสัชเติม TMT)
**ต่อยอด G07/G09:** ให้อัปโหลด Drug Catalog ที่ส่ง สกส. (ไฟล์ Excel) แล้วเทียบ TMT และ Product Category กับ `drugitems` ส่วนในไฟล์ส่งเบิกให้เทียบกับ DispensedItems `[1] PrdCat`, `[2] HospDrgID`

```sql
SELECT oi.vn, d.icode, d.name
FROM opitemrece oi JOIN drugitems d ON d.icode = oi.icode
WHERE oi.vn IN :vns AND (oi.an IS NULL OR oi.an = '')
  AND oi.paidst = '02' AND COALESCE(TRIM(d.tmt_tp_code),'') = ''
```

---

### L01 — Lab ที่ไม่มี TMLT
**ที่มา:** L01/L02 (5) "รหัส TMLT ไม่พบในรายการอ้างอิง" เช่น Aerobic culture
**พบใน 30 วัน:** 126 รายการ lab ที่สั่งให้สิทธิ กบก./อปท. แต่ทั้ง `lab_items.tmlt_code` และ `nondrugitems.sks_tmlt_code` ว่าง

```sql
SELECT DISTINCT h.vn, li.lab_items_name
FROM lab_head h
JOIN lab_order lo ON lo.lab_order_number = h.lab_order_number
JOIN lab_items li ON li.lab_items_code = lo.lab_items_code
LEFT JOIN nondrugitems n ON n.icode = li.icode
JOIN opitemrece oi ON oi.vn = h.vn AND oi.icode = li.icode AND oi.paidst = '02'
WHERE h.vn IN :vns
  AND COALESCE(NULLIF(TRIM(li.tmlt_code),''), NULLIF(TRIM(n.sks_tmlt_code),'')) IS NULL
```
**แนะนำ:** ทำเป็น "รายงานทะเบียน" (แบบหน้า ClaimCat master) ให้แผนก lab เติมทีเดียว ดีกว่าเตือนทุก visit

---

### LAB01 — สั่ง lab แต่ไม่ได้ส่งตรวจ (ทำทีหลัง)
**ที่มา:** "สั่ง lab แต่ไม่ได้ส่งตรวจ… สาเหตุจากแพทย์กด Remed Lab จากครั้งก่อน", "lab ทั้ง 7 รายการไม่พบผล"
**พบใน 30 วัน:** lab ที่ผลว่างและยังไม่ยืนยันผลเกิน 3 วัน 10 visit/81 รายการ ส่วนแบบ "ยืนยันแล้วแต่ผลว่าง" มี 9,555 รายการ ซึ่งส่วนใหญ่เป็นหัวข้อของชุดตรวจ จึง noise สูงเกินไป

**Logic ที่เสนอ:** `lab_head` ที่มีค่าใช้จ่ายแต่ `receive_date` ว่าง (ไม่ได้รับสิ่งส่งตรวจ) และ visit ผ่านไปแล้วเกิน 1 วัน → INFO
ต้องทดสอบก่อนว่า `receive_date` / `confirm_specimen` ใช้งานจริงที่ รพ. หรือไม่

---

## 4. สิ่งที่ต้องขอเพื่อเริ่มลงมือ
1. **การเงิน:** ตารางหัตถการ → เวชภัณฑ์ที่เหมารวม ตามมติ 9 เม.ย. 69 โดยเฉพาะหัตถการ OR (ใช้กับ BND01 ระดับ B)
2. **ว.435:** หัตถการที่พยาบาลสั่งได้เอง (ใช้เป็นรายการยกเว้นของ ORD01)
3. **IT:** ยืนยันว่า OPServices ฟิลด์ [11] มาจาก `doctor.licenseno` อย่างไร (ใช้กับ S48)
4. **เภสัช:** ไฟล์ Drug Catalog ล่าสุดที่ส่ง สกส. (ใช้กับ G07/G09)

## 5. ผลต่อระบบ
- **Live OPD:** เพิ่ม 9 query ต่อรอบ ทุก query กรองด้วย `vn IN :vns` จึงเร็ว (คาดว่ารวม < 0.5 วินาทีต่อ 400 visit)
- **readiness:** เพิ่มตาราง `lab_head`, `lab_order`, `lab_items`, `provider_type` ใน `LIVE_REQUIREMENTS` ต้อง GRANT SELECT ให้ `claim_check` ด้วย (ถ้า GRANT ทั้ง schema ไว้แล้วก็ไม่ต้องทำเพิ่ม)
- **ไฟล์ส่งเบิก:** เพิ่ม V02, C05, Q04, S48 ใน `c_code_checker` → แสดงในหน้าตรวจไฟล์และ `_merge_fix_rules` อัตโนมัติ
- **IPD:** BND01 / ORD01 / PAY01 ใช้ query เดียวกันได้ โดยเปลี่ยน `vn` เป็น `an` (ทำเป็นรอบที่ 2)
