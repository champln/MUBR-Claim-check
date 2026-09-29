import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  BookOpen, Search, ChevronRight, AlertTriangle, CheckCircle2, Lightbulb,
} from 'lucide-react'
import clsx from 'clsx'

type Guide = {
  group: 'ทั่วไป' | 'ผู้ป่วยนอก' | 'ผู้ป่วยใน'
  to: string
  title: string
  when: string          // ใช้เมื่อไร
  steps: string[]       // ขั้นตอน
  notes?: string[]      // ข้อควรรู้
  codes?: string[]      // รหัส C ที่เกี่ยวข้อง
}

const GUIDES: Guide[] = [
  {
    group: 'ทั่วไป',
    to: '/claim-files',
    title: 'ตรวจไฟล์ส่งเบิก',
    when: 'อยากรู้ว่าไฟล์ชุดนี้มีข้อผิดพลาดอะไรบ้างก่อนส่ง หรืออยากแก้ค่าในไฟล์เองทีละช่อง',
    steps: [
      'ลากไฟล์ .zip ทั้งชุด (หรือ .txt/.xml ทีละไฟล์) ลงกรอบอัปโหลด — ระบบจะอ่านชื่อกองทุน เลขงวด เดือน/ปี ให้อัตโนมัติ แก้เองได้',
      'กด "เริ่มตรวจสอบ" ระบบจะแสดงจำนวนข้อผิดพลาดและคำเตือน',
      'กดเข้าไปในรายการเพื่อดูว่าติดอะไรบ้าง กรองเฉพาะที่ผิด/ที่เตือนได้ และค้นด้วย VN, เลขบัตร หรือชื่อผู้ป่วย',
      'ถ้าต้องการแก้ค่าในไฟล์ กดปุ่มม่วง "แก้ไขไฟล์ + MD5" ที่รายการนั้นในประวัติ',
      'ในหน้าแก้ไข เลือกแฟ้ม → เลือกส่วน (เช่น BillItems) → คลิกช่องแล้วพิมพ์แก้ได้เลย',
      'กด "บันทึก" แล้วกด "ดาวน์โหลด + เซ็น MD5 ใหม่" จะได้ไฟล์ zip ชื่อเดิมที่ลายเซ็นถูกต้อง',
    ],
    notes: [
      'ในตารางแก้ไข: Enter หรือลูกศรลง = ลงแถวถัดไป · ลูกศรขึ้น = ขึ้น · Tab = ไปขวา · Esc = คืนค่าเดิมของช่องนั้น',
      'ช่องที่แก้จะเป็นสีเหลือง เอาเมาส์ชี้ค้างไว้จะเห็นค่าเดิม',
      'ปุ่มดาวน์โหลดจะกดได้ต่อเมื่อบันทึกทุกช่องที่แก้แล้ว',
      'session ที่อัปโหลดไว้ก่อนระบบจะเก็บไฟล์ต้นฉบับ จะแก้ไม่ได้ ให้อัปโหลดไฟล์ชุดนั้นใหม่',
    ],
  },
  {
    group: 'ผู้ป่วยนอก',
    to: '/stdcode-fix',
    title: 'แก้รหัสหัตถการ (S19/S41)',
    codes: ['S19', 'S41'],
    when: 'ติด C เพราะรายการหัตถการไม่มีรหัส STDCode หรือรหัสไม่ตรง CodeSet',
    steps: [
      'อัปโหลดไฟล์ OPServices (หรือ .zip ทั้งชุด)',
      'กด "ตรวจสอบก่อนแก้" ระบบจะบอกว่าจะเติมรหัสให้กี่แถว และเอารหัสมาจากไหน',
      'แถวที่ระบบหารหัสไม่ได้ จะให้กรอกรหัสเอง ติ๊ก "จำรหัสไว้ในคลัง" เพื่อใช้ครั้งหน้า',
      'กด "แก้ไข & ดาวน์โหลด"',
    ],
    notes: [
      'ระบบหารหัสจากคลังรหัสหัตถการก่อน ถ้าไม่มีจะดูจากแถวอื่นในไฟล์เดียวกันที่ใช้รหัสบริการเดียวกัน',
      'ถ้ารหัสในไฟล์ขัดกันเอง ระบบจะไม่เดา แต่จะยกมาให้กรอกเอง',
      'คลังรหัสอยู่ท้ายหน้า แก้/ลบได้ตลอด เพราะรหัสมาตรฐานเปลี่ยนได้',
    ],
  },
  {
    group: 'ผู้ป่วยนอก',
    to: '/opd-fee-fix',
    title: 'แก้ยอดค่าบริการ ผป.นอก (A04/T33/45)',
    codes: ['A04', 'T33', 'T45'],
    when: 'ติด C เพราะยอดเบิกของค่าบริการเป็น 0.00 หรือยอดหัวบิลไม่ตรงกับผลรวมรายการ',
    steps: [
      'อัปโหลดไฟล์ BILLTRAN (หรือ .zip ทั้งชุด)',
      'เลือกว่าจะให้ทำอะไรบ้าง — เติมยอดเบิก (T33/45) และ/หรือ ปรับยอดหัวบิล (A04)',
      'กด "ตรวจสอบก่อนแก้" ดูรายการที่จะถูกแก้และส่วนต่างของยอด',
      'กด "แก้ไข & ดาวน์โหลด"',
    ],
    notes: [
      'ระบบดูที่รหัสมาตรฐาน 55020 ไม่ได้ไล่แก้ทุกแถวที่เป็น 0.00 — ค่าธรรมเนียมโรงพยาบาลที่เป็น 0.00 โดยตั้งใจจะไม่ถูกแตะ',
      'ยอดหัวบิลจะถูกคำนวณจากผลรวมรายการจริง ทำหลังเติมยอดเบิกเสมอ',
      'ถ้าส่วนต่างเยอะผิดปกติ ให้เปิดดูก่อนว่ารายการในไฟล์ครบจริงไหม ก่อนกดแก้',
    ],
  },
  {
    group: 'ผู้ป่วยนอก',
    to: '/svdate-fix',
    title: 'แก้วันที่ให้บริการ (T42)',
    codes: ['T42'],
    when: 'ติด C เพราะวันที่ของรายการไม่ตรงกับวันที่มารับบริการ',
    steps: [
      'อัปโหลดไฟล์ BILLTRAN (หรือ .zip ทั้งชุด)',
      'กด "ตรวจสอบก่อนแก้" ระบบจะเทียบวันที่ของแต่ละรายการกับวัน visit ให้เอง',
      'กด "แก้ไข & ดาวน์โหลด"',
    ],
    notes: [
      'ไม่ต้องกรอกวันที่เอง ระบบอ่านวัน visit จาก BILLTRAN ของแต่ละ Inv.no',
      'ถ้าแฟ้มอื่น (OPServices/Dispensing) วันที่ไม่ตรงด้วย ระบบจะเตือนแต่ไม่แก้ให้ เพราะอาจเป็นวัน visit เองที่ผิด ควรเช็ค HOSxP ก่อน',
    ],
  },
  {
    group: 'ผู้ป่วยใน',
    to: '/cipn-fix',
    title: 'ตรวจ/แก้ ClaimCat ผู้ป่วยใน',
    codes: ['30', '35', '36'],
    when: 'ไฟล์ผู้ป่วยในถูกตีกลับเรื่องยอดรวม (DRGCharge/XDRGClaim) หรือ ClaimCat ไม่ตรงเงื่อนไขการเบิก',
    steps: [
      'อัปโหลดไฟล์ CIPN/AIPN (.xml หรือ .zip) ครั้งละ 1 ไฟล์',
      'กด "ตรวจไฟล์" — ระบบจะบอกทุกข้อที่ผิดสเปก พร้อมเทียบยอดในไฟล์กับยอดที่คำนวณได้จริง',
      'แถวสีเหลืองคือแถวที่ ClaimCat น่าจะไม่ถูก เลือกค่าใหม่ในช่อง "เปลี่ยนเป็น"',
      'กดปุ่มดาวน์โหลด — ระบบแก้ ClaimCat, คำนวณ DRGCharge/XDRGClaim, เซ็น HMAC และตั้งชื่อไฟล์ใหม่ให้ครบในครั้งเดียว',
    ],
    notes: [
      'T = เบิกแยกนอก DRG (ห้อง/อาหาร, อวัยวะเทียม) · D = รวมอยู่ใน DRG · X = ไม่ขอเบิก',
      'เปลี่ยนเป็น T ต้องกรอกราคาเบิกต่อหน่วยตามบัญชีอัตราของกรมบัญชีกลางเอง — ระบบไม่คิดให้จากยอดที่เรียกเก็บ เพราะจะกลายเป็นเบิกเงินที่ไม่มีสิทธิ์',
      'ถ้าแค่ยอดรวมหรือ HMAC ไม่ตรง กดดาวน์โหลดได้เลยโดยไม่ต้องเลือกแถวไหน',
      'ระบบบันทึกไว้ว่าใครแก้แถวไหน จากค่าอะไรเป็นอะไร',
    ],
  },
  {
    group: 'ผู้ป่วยใน',
    to: '/cipn-daterev',
    title: 'แก้ DateRev ผู้ป่วยใน',
    when: 'รายการในไฟล์ผู้ป่วยในมีวันที่ปรับปรุงล่าสุดเป็นวันที่ export แทนวันที่จริง หรือไฟล์ถูกแก้มือมาจนค่า HMAC ไม่ตรง',
    steps: [
      'อัปโหลดไฟล์ CIPN/AIPN (.xml หรือ .zip) ครั้งละ 1 ไฟล์',
      'กด "ตรวจสอบไฟล์" — แถวสีแดงคือรายการที่ DateRev ว่างหรือเท่ากับวันที่ export',
      'กรอกวันที่ที่ถูกต้องในช่อง "แก้เป็น" (รูปแบบ YYYY-MM-DD) หรือใส่ทีเดียวทุกแถวที่น่าสงสัย',
      'กด "แก้ไข & ดาวน์โหลด" — ระบบคำนวณค่า HMAC ใหม่ให้อัตโนมัติ',
    ],
    notes: [
      'ถ้าไฟล์ถูกแก้มือมาแล้วค่า HMAC ไม่ตรง ให้กด "หาค่า HMAC & ดาวน์โหลด" ระบบจะคำนวณใหม่ให้โดยไม่แตะข้อมูล',
      'วันที่ต้องเป็น YYYY-MM-DD เช่น 10 ก.พ. 2005 = 2005-02-10 (ระวังสลับเดือนกับวัน)',
      'มีช่องค้นหารายการ ค้นได้ทั้งรหัส ชื่อรายการ และวันที่',
    ],
  },
  {
    group: 'ผู้ป่วยนอก',
    to: '/rama-sh50',
    title: 'เติมข้อมูล ปกส.รามา SH50',
    when: 'ไฟล์ประกันสังคมที่ รพ.หลักเป็นรามาธิบดี ต้องเติมรหัส รพ.หลักและผู้ร่วมจ่าย 50 บาท',
    steps: [
      'อัปโหลดไฟล์ BILLTRAN หรือ .zip ทั้งชุด',
      'ถ้ามี Inv.no ที่ไม่ต้องเติม (มาหลาย VN ในวันเดียวกัน) ใส่ในช่องยกเว้น',
      'กด "ตรวจสอบก่อนแก้" แล้ว "แก้ไข & ดาวน์โหลด" — ได้ zip ชื่อเดิม',
    ],
  },
  {
    group: 'ผู้ป่วยนอก',
    to: '/tmt-fix',
    title: 'แก้ไขรหัส TMT ยา',
    when: 'ต้องเปลี่ยนรหัส TMT ของยาให้ตรงกันทั้งใน BILLTRAN และ BILLDISP',
    steps: [
      'อัปโหลดไฟล์ .zip ทั้งชุด (เพื่อให้แก้ได้ทั้ง 2 แฟ้ม)',
      'กรอกกฎ: จับคู่ด้วยรหัส TMT เดิม หรือรหัสยาของ รพ. แล้วใส่ TMT ใหม่ — หรืออัปโหลดไฟล์ Excel/CSV',
      'กด "ตรวจสอบก่อนแก้" แล้ว "แก้ไข & ดาวน์โหลด"',
    ],
    notes: ['เมนูนี้ยังไม่เคยตรวจเทียบกับไฟล์จริงคู่ก่อน/หลัง แนะนำให้ดูผล preview ให้ละเอียดก่อนใช้จริง'],
  },
  {
    group: 'ผู้ป่วยนอก',
    to: '/covid19-fix',
    title: 'แก้ไฟล์ COVID-19',
    when: 'ต้องเติมรหัสอนุมัติ COV-19 ให้ visit ที่เกี่ยวกับโควิด',
    steps: [
      'อัปโหลดไฟล์ BILLTRAN',
      'ระบุ Inv.no หรือ HN ที่ต้องการ หรือกดเติมทุก VN',
      'กด "ตรวจสอบก่อนแก้" แล้ว "แก้ไข & ดาวน์โหลด"',
    ],
  },
  {
    group: 'ผู้ป่วยนอก',
    to: '/cpap-fix',
    title: 'แก้ไฟล์ CPAP/PSG',
    when: 'ไฟล์เคลม CPAP หรือตรวจการนอนหลับ ต้องเติมรหัสอนุมัติและแก้ Class/SvPID',
    steps: ['อัปโหลดไฟล์ชุดที่มี CPAP/PSG', 'ตรวจ visit ที่ระบบจับได้', 'กดแก้แล้วดาวน์โหลด'],
  },
]

const C_CODES = [
  { code: 'S19', meaning: 'รหัสการให้บริการไม่ถูกต้องหรือไม่สัมพันธ์กับ CodeSet', to: '/stdcode-fix', menu: 'แก้รหัสหัตถการ' },
  { code: 'S41', meaning: 'Class เป็นหัตถการ (OP) แต่ไม่แจ้งรหัสที่ STDCode', to: '/stdcode-fix', menu: 'แก้รหัสหัตถการ' },
  { code: 'A04', meaning: 'ยอดหัวบิลไม่ตรงกับผลรวมรายการ', to: '/opd-fee-fix', menu: 'แก้ยอดค่าบริการ' },
  { code: 'T33 / T45', meaning: 'ค่าบริการทั่วไป ผป.นอก มียอดเบิกเป็น 0.00', to: '/opd-fee-fix', menu: 'แก้ยอดค่าบริการ' },
  { code: 'T42', meaning: 'SVDATE ไม่สัมพันธ์กับ BILLTRAN (วันที่รายการไม่ตรงวัน visit)', to: '/svdate-fix', menu: 'แก้วันที่ให้บริการ' },
  { code: '22', meaning: 'ค่า HMAC ท้ายไฟล์ผู้ป่วยในไม่ตรงกับเนื้อไฟล์', to: '/cipn-daterev', menu: 'แก้ DateRev ผู้ป่วยใน' },
  { code: '30', meaning: 'รูปแบบไฟล์ผู้ป่วยในไม่ถูกต้อง (โครงสร้าง/จำนวนฟิลด์/Reccount)', to: '/cipn-fix', menu: 'ตรวจ/แก้ ClaimCat ผู้ป่วยใน' },
  { code: '35', meaning: 'ผลรวม DRGCharge ไม่ถูกต้อง (มักมาจาก ClaimCat ของค่าห้องผิด)', to: '/cipn-fix', menu: 'ตรวจ/แก้ ClaimCat ผู้ป่วยใน' },
  { code: '36', meaning: 'ผลรวม XDRGClaim ไม่ถูกต้อง (บั๊กการ export ของ HOSxP)', to: '/cipn-fix', menu: 'ตรวจ/แก้ ClaimCat ผู้ป่วยใน' },
]

export default function HelpPage() {
  const [q, setQ] = useState('')
  const key = q.trim().toLowerCase()
  const guides = GUIDES.filter(g => !key
    || g.title.toLowerCase().includes(key)
    || g.when.toLowerCase().includes(key)
    || (g.codes || []).some(c => c.toLowerCase().includes(key))
    || g.steps.some(s => s.toLowerCase().includes(key)))

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-blue-600" /> วิธีใช้งาน
        </h2>
        <p className="text-sm text-gray-500 mt-0.5">
          ระบบตรวจและแก้ไฟล์ส่งเบิกก่อนส่ง สกส. — ศูนย์การแพทย์มหิดลบำรุงรักษ์ (รหัส 40922)
        </p>
      </div>

      {/* หลักการทำงาน */}
      <div className="card p-5 space-y-2.5">
        <h3 className="font-semibold text-gray-800 text-sm flex items-center gap-2">
          <Lightbulb className="w-4 h-4 text-amber-500" /> หลักการที่ทุกเมนูใช้เหมือนกัน
        </h3>
        <ul className="text-sm text-gray-600 space-y-1.5 list-disc pl-5">
          <li><b>ตรวจก่อนแก้เสมอ</b> — ทุกเมนูมีปุ่มดูผลก่อน ว่าจะแก้แถวไหน จากค่าอะไรเป็นอะไร</li>
          <li><b>แก้เฉพาะช่องที่ตั้งใจ</b> — ไบต์อื่นในไฟล์คงเดิมทุกตัว รวมทั้งภาษาไทยและการขึ้นบรรทัด</li>
          <li><b>เซ็นไฟล์ใหม่ให้อัตโนมัติ</b> — ผู้ป่วยนอกใช้ Checksum (MD5) ผู้ป่วยในใช้ค่า HMAC ไม่ต้องคำนวณเอง</li>
          <li><b>คืนไฟล์ชื่อเดิม</b> — อัปโหลด .zip ทั้งชุดได้ ระบบแก้เฉพาะแฟ้มที่เกี่ยว แฟ้มอื่นไม่ถูกแตะ</li>
        </ul>
      </div>

      {/* ตารางรหัส C */}
      <div className="card overflow-hidden">
        <div className="px-4 py-2.5 border-b bg-gray-50">
          <h3 className="font-semibold text-gray-800 text-sm">ติด C รหัสนี้ ใช้เมนูไหน</h3>
        </div>
        <table className="w-full text-sm">
          <thead className="border-b text-xs text-gray-500 uppercase">
            <tr>
              <th className="px-4 py-2 text-left w-28">รหัส</th>
              <th className="px-4 py-2 text-left">ความหมาย</th>
              <th className="px-4 py-2 text-left w-52">เมนูที่ใช้</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {C_CODES.map(c => (
              <tr key={c.code} className="hover:bg-blue-50/30">
                <td className="px-4 py-2 font-mono font-semibold text-rose-600">{c.code}</td>
                <td className="px-4 py-2 text-gray-700">{c.meaning}</td>
                <td className="px-4 py-2">
                  <Link to={c.to} className="text-blue-600 hover:text-blue-700 inline-flex items-center gap-1">
                    {c.menu} <ChevronRight className="w-3.5 h-3.5" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ค้นหา */}
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={q} onChange={e => setQ(e.target.value)}
          placeholder="ค้นหาวิธีใช้ เช่น S41, ยอดเบิก, DateRev, zip"
          className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm focus:ring-2 focus:ring-blue-300 outline-none" />
      </div>

      {/* คู่มือรายเมนู แยกตามกลุ่มเหมือนแถบเมนูซ้าย */}
      <div className="space-y-6">
        {(['ทั่วไป', 'ผู้ป่วยนอก', 'ผู้ป่วยใน'] as const).map(group => {
          const inGroup = guides.filter(g => g.group === group)
          if (!inGroup.length) return null
          return (
            <div key={group} className="space-y-3">
              <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                <span className={clsx('w-2 h-2 rounded-full',
                  group === 'ผู้ป่วยนอก' ? 'bg-amber-400' : group === 'ผู้ป่วยใน' ? 'bg-violet-500' : 'bg-blue-500')} />
                {group === 'ทั่วไป' ? 'ใช้ได้กับทุกแบบ'
                  : group === 'ผู้ป่วยนอก' ? 'แก้ไฟล์ผู้ป่วยนอก (BILLTRAN · BILLDISP · OPServices)'
                  : 'แก้ไฟล์ผู้ป่วยใน (CIPN · AIPN)'}
              </h3>
              {inGroup.map(g => (
          <div key={g.to} className="card p-5 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Link to={g.to} className="font-semibold text-gray-900 hover:text-blue-700">{g.title}</Link>
              {(g.codes || []).map(c => (
                <span key={c} className="text-[11px] font-mono bg-rose-100 text-rose-700 rounded px-1.5 py-0.5">{c}</span>
              ))}
            </div>
            <p className="text-sm text-gray-600"><b className="text-gray-700">ใช้เมื่อ:</b> {g.when}</p>
            <ol className="text-sm text-gray-700 space-y-1.5">
              {g.steps.map((s, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-[11px] font-semibold flex items-center justify-center">{i + 1}</span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
            {g.notes && (
              <ul className="text-xs text-gray-500 space-y-1 bg-gray-50 rounded-lg p-3">
                {g.notes.map((n, i) => (
                  <li key={i} className="flex gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />{n}</li>
                ))}
              </ul>
            )}
          </div>
              ))}
            </div>
          )
        })}
        {guides.length === 0 && (
          <div className="card p-8 text-center text-sm text-gray-400">ไม่พบวิธีใช้ที่ตรงกับ "{q.trim()}"</div>
        )}
      </div>

      {/* ปัญหาที่พบบ่อย */}
      <div className="card p-5 space-y-3">
        <h3 className="font-semibold text-gray-800 text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-500" /> ปัญหาที่พบบ่อย
        </h3>
        {[
          {
            q: 'ส่งไฟล์ผู้ป่วยในแล้วถูกตีกลับ "รหัส 22 hmac ไม่ตรงกับที่ระบุ"',
            a: 'ไฟล์ถูกแก้โดยไม่ได้คำนวณค่า HMAC ใหม่ (เช่นแก้ด้วย Notepad) แม้จะคำนวณเองถูก แต่ถ้าโปรแกรมแก้ไขข้อความกินบรรทัดว่างท้ายไฟล์ไป ค่าก็เปลี่ยนแล้ว — ให้อัปโหลดไฟล์เข้าเมนู "แก้ DateRev ผู้ป่วยใน" แล้วกด "หาค่า HMAC & ดาวน์โหลด"',
          },
          {
            q: 'อย่าแก้ไฟล์ส่งเบิกด้วย Notepad',
            a: 'ทุกไฟล์มีลายเซ็นท้ายไฟล์ที่ผูกกับเนื้อไฟล์ แก้แล้วไม่เซ็นใหม่จะถูกตีกลับทันที ให้แก้ผ่านระบบนี้ซึ่งเซ็นให้อัตโนมัติ',
          },
          {
            q: 'ขึ้น "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้" หรือถูกเด้งออกไปหน้า login',
            a: 'เซสชันหมดอายุ (12 ชั่วโมง) ให้เข้าสู่ระบบใหม่ ถ้ายังไม่ได้แจ้งผู้ดูแลระบบ',
          },
          {
            q: 'ไฟล์ AIPN เปิดดูได้แต่แก้ไม่ได้',
            a: 'ถ้าค่า HMAC เดิมของไฟล์ไม่ตรงกับเนื้อไฟล์ ระบบจะไม่ยอมเซ็นทับให้ ต้องตรวจไฟล์ต้นทางก่อน',
          },
          {
            q: 'ผลลัพธ์ออกมาไม่ตรงกับที่คาด',
            a: 'ดูผลหน้า "ตรวจสอบก่อนแก้" ว่าระบบจะแก้แถวไหนบ้าง ถ้าไม่ตรงกับที่ต้องการ อย่ากดแก้ ให้แจ้งผู้ดูแลระบบพร้อมชื่อไฟล์',
          },
        ].map((item, i) => (
          <div key={i} className="text-sm border-l-2 border-amber-200 pl-3">
            <div className="font-medium text-gray-800">{item.q}</div>
            <div className="text-gray-600 mt-0.5">{item.a}</div>
          </div>
        ))}
      </div>

      <p className="text-xs text-gray-400">
        พบปัญหาหรืออยากให้เพิ่มการแก้กรณีใหม่ แจ้งผู้ดูแลระบบพร้อมไฟล์ตัวอย่าง (ก่อนแก้/หลังแก้) จะช่วยให้ตรวจสอบได้เร็วที่สุด
      </p>
    </div>
  )
}
