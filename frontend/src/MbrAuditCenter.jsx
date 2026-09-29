import React, { useState, useMemo, useRef } from 'react';
import {
  ShieldCheck, AlertTriangle, FileText, Activity, Users, Search, Settings,
  CheckCircle, XCircle, Filter, Download, Plus, Edit2, Trash2,
  X, Save, FileCode, HelpCircle, FileDigit, Syringe, LayoutList,
  FileDown, Pill, Database, Copy, Layers, Wind, ExternalLink
} from 'lucide-react';

// --- DEFAULT SQL SCRIPTS ---
const DEFAULT_SQL_SCRIPTS = [
  {
    id: '1',
    title: 'รายงาน OPD รายเดือน สิทธิกรมบัญชีกลาง (16 หมวด)',
    desc: 'ดึงข้อมูลค่าใช้จ่ายแยกหมวด กบก. สำหรับอัปโหลดเข้าระบบ MBR Audit',
    code: `/* =========================================================
   HOSxP XE (PostgreSQL)
   รายงาน OPD รายเดือน สิทธิกรมบัญชีกลาง (pttype='21')
   ค่าใช้จ่ายแยกตาม income 16 หมวด
========================================================= */
WITH params AS ( SELECT '2025-12-01'::date AS start_date, '2025-12-31'::date AS end_date ), base_opd AS ( SELECT op.vn, op.vstdate, o.hn, CONCAT(p.pname, p.fname, ' ', p.lname) AS patient_name, op.income, op.sum_price, COALESCE(nd.billcode, op.icode) AS billcode FROM opitemrece op CROSS JOIN params JOIN ovst o ON o.vn = op.vn JOIN patient p ON p.hn = o.hn LEFT JOIN nondrugitems nd ON nd.icode = op.icode WHERE op.vstdate BETWEEN params.start_date AND params.end_date AND op.an IS NULL AND o.pttype = '21' ) SELECT * FROM base_opd LIMIT 500;`
  }
];

// --- RULES CONFIGURATION ---
const DEFAULT_RULES = [
  { id: 'C01', category: 'C_ERROR', label: 'C01: ไม่พบรหัสกรมบัญชีกลาง (Missing StdCode)', desc: 'รายการค่ารักษาใน BILLTRAN ต้องระบุรหัสกรมบัญชีกลาง (StdCode)', active: true, severity: 'Critical', sql: 'income_amt > 0 AND (billcode IS NULL OR billcode = "")' },
  { id: 'C02', category: 'C_ERROR', label: 'C02: เพศไม่สัมพันธ์กับโรค (Gender Mismatch)', desc: 'เพศของผู้ป่วยขัดแย้งกับรหัสโรค (ICD-10)', active: true, severity: 'Critical', sql: '(sex = "1" AND icd10 BETWEEN "N70" AND "N98")' },
  { id: 'C03', category: 'C_ERROR', label: 'C03: ไม่พบการวินิจฉัยโรคหลัก (Principal Dx Missing)', desc: 'ต้องมีการบันทึกวินิจฉัยโรคหลัก (OPDx ที่ SL=1) เสมอ', active: true, severity: 'Critical', sql: 'pdx_code IS NULL OR pdx_code = ""' },
  { id: 'C04', category: 'C_ERROR', label: 'C04: ข้อมูลยายังไม่สมบูรณ์ (Missing DrgID)', desc: 'ยาในข้อมูล BILLDISP ต้องระบุรหัสมาตรฐาน 24 หลัก (DrgID)', active: true, severity: 'Critical', sql: '' },
  { id: 'W01', category: 'LOCAL_RULE', label: 'W01: แจ้งเตือนค่าใช้จ่ายสูง (High Cost Alert)', desc: 'แจ้งเตือนเมื่อยอดเงินรวม (BillAmt) เกิน 10,000 บาท', active: false, severity: 'Warning', sql: 'total_amount > 10000' },
];

// Helper: Clean BOM and whitespace
const cleanString = (str) => {
  if (!str) return "";
  return str.replace(/^﻿/, '').trim();
};

/* =========================================================
   ตัวเข้ารหัส windows-874 / TIS-620 (กฎเหล็กข้อ 1)
   เบราว์เซอร์เขียน Blob ได้เฉพาะ UTF-8 จึงต้องแปลงเป็น byte เอง
   - ASCII (0x00-0x7F) คงเดิม
   - อักษรไทย U+0E01..U+0E5B แมปเป็น byte 0xA1..0xFB
   - อักขระอื่นที่ไม่รองรับแทนด้วย '?' (0x3F)
========================================================= */
const encodeWindows874 = (str) => {
  const out = [];
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (cp <= 0x7F) out.push(cp);
    else if (cp >= 0x0E01 && cp <= 0x0E5B) out.push(cp - 0x0E00 + 0xA0);
    else out.push(0x3F);
  }
  return new Uint8Array(out);
};

/* =========================================================
   MD5 (RFC 1321) เหนือ byte array — ใช้เซ็นลายเซ็นท้ายไฟล์ สกส.
   <?EndNote Checksum="MD5ของไบต์ก่อน <?EndNote ตัวพิมพ์ใหญ่"?>
   (สูตรพิสูจน์ byte-exact แล้วกับไฟล์จริงทั้ง CSOP และ SSOP)
========================================================= */
const md5Hex = (bytes) => {
  const S = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,
             5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,
             4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,
             6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
  const K = new Array(64).fill(0).map((_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296));
  const rotl = (x, c) => (x << c) | (x >>> (32 - c));
  const len = bytes.length;
  const padded = (Math.floor((len + 8) / 64) + 1) * 64;
  const buf = new Uint8Array(padded);
  buf.set(bytes); buf[len] = 0x80;
  const dv = new DataView(buf.buffer);
  const bitLen = len * 8;
  dv.setUint32(padded - 8, bitLen >>> 0, true);
  dv.setUint32(padded - 4, Math.floor(bitLen / 4294967296), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let ofs = 0; ofs < padded; ofs += 64) {
    const M = new Array(16);
    for (let j = 0; j < 16; j++) M[j] = dv.getUint32(ofs + j * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i] + M[g]) >>> 0;
      A = D; D = C; C = B;
      B = (B + rotl(F, S[i])) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  const hex = n => { let s = ''; for (let i = 0; i < 4; i++) s += ((n >>> (i * 8)) & 0xff).toString(16).padStart(2, '0'); return s; };
  return (hex(a0) + hex(b0) + hex(c0) + hex(d0)).toUpperCase();
};

// ดาวน์โหลดไฟล์ข้อความด้วย encoding windows-874 (ภาษาไทยไม่พัง)
const downloadWin874 = (content, filename) => {
  const blob = new Blob([encodeWindows874(content)], { type: 'text/plain;charset=windows-874' });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
};

const runAuditRules = (visit, rules) => {
  const errors = [];
  // C01/C04 เป็นกฎเฉพาะ layout ผู้ป่วยนอก (OPD) — ข้ามสำหรับไฟล์ผู้ป่วยใน AIPN
  // C01: ยกเว้น BillMu='G' (ค่าธรรมเนียมโรงพยาบาล) ซึ่ง HOSxP ไม่ใส่ StdCode เป็นปกติ
  if (!visit.isIPD && rules.find(r => r.id === 'C01')?.active && visit.items.some(it => it.ChargeAmt > 0 && it.BillMu !== 'G' && (!it.StdCode || it.StdCode.trim() === ''))) errors.push('C01');
  if (rules.find(r => r.id === 'C03')?.active && !(visit.dxList && visit.dxList.some(d => d.SL === '1' && d.Code))) errors.push('C03');
  if (!visit.isIPD && rules.find(r => r.id === 'C04')?.active && visit.dispensedItems && visit.dispensedItems.some(it => !it.DrgID || it.DrgID.trim() === '')) errors.push('C04');
  if (rules.find(r => r.id === 'W01')?.active && visit.Amount > 10000) errors.push('W01');

  if (rules.find(r => r.id === 'C02')?.active) {
     if (visit.Name && visit.Name.startsWith('นาย') && visit.dxList.some(dx => dx.Code.startsWith('N80'))) errors.push('C02');
  }

  const pDx = visit.dxList.find(d => d.SL === '1');
  return { ...visit, errors, status: errors.length > 0 ? 'FAIL' : 'PASS', Code: pDx ? pDx.Code : '-', BillAmt: visit.Amount };
};

const copyToClipboard = (text) => {
  navigator.clipboard.writeText(text).then(() => alert('คัดลอกคำสั่ง SQL แล้ว สามารถนำไปวางในโปรแกรมฐานข้อมูลได้เลย')).catch(() => {
    const el = document.createElement('textarea');
    el.value = text;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    alert('คัดลอกคำสั่ง SQL แล้ว สามารถนำไปวางในโปรแกรมฐานข้อมูลได้เลย');
  });
};

const App = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [data, setData] = useState([]);
  const [rules, setRules] = useState(DEFAULT_RULES);
  const [sqlScripts, setSqlScripts] = useState(DEFAULT_SQL_SCRIPTS);
  const [filterText, setFilterText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedVisit, setSelectedVisit] = useState(null);
  const [loadedFiles, setLoadedFiles] = useState({ BILLTRAN: false, OPServices: false, BILLDISP: false, CSV: false, AIPN: false });
  // header ต้นฉบับของแต่ละไฟล์ (<?xml ... </Header>) — เก็บไว้ใช้ตอน export เพื่อคง PayPlan/SESSNO เดิม
  const [rawHeaders, setRawHeaders] = useState({});
  const [uploadMessage, setUploadMessage] = useState('');
  const fileInputRef = useRef(null);

  // Modals
  const [isRuleModalOpen, setIsRuleModalOpen] = useState(false);
  const [currentRule, setCurrentRule] = useState(null);
  const [isEditingRule, setIsEditingRule] = useState(false);
  const [isSqlModalOpen, setIsSqlModalOpen] = useState(false);
  const [currentSql, setCurrentSql] = useState(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editFormData, setEditFormData] = useState(null);
  const [showHelp, setShowHelp] = useState(false);
  // Bulk edit
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);
  const [bulkField, setBulkField] = useState('');
  const [bulkValue, setBulkValue] = useState('');

  const filteredData = useMemo(() => {
    return data.filter(item =>
      (item.Name && item.Name.includes(filterText)) ||
      (item.SvID && item.SvID.includes(filterText)) ||
      (item.HN && item.HN.includes(filterText)) ||
      (item.InvNo && item.InvNo.includes(filterText))
    );
  }, [data, filterText]);

  const stats = useMemo(() => {
    return {
      total: data.length, passed: data.filter(d => d.status === 'PASS').length, failed: data.filter(d => d.status === 'FAIL').length, totalAmount: data.reduce((acc, curr) => acc + (curr.Amount || 0), 0)
    };
  }, [data]);

  // --- Handlers ---
  const toggleRule = (id) => { const updated = rules.map(r => r.id === id ? { ...r, active: !r.active } : r); setRules(updated); setData(data.map(v => runAuditRules(v, updated))); };
  const handleDeleteRule = (id) => { if(window.confirm('คุณต้องการลบกฎข้อนี้ใช่หรือไม่?')) { const updated = rules.filter(r => r.id !== id); setRules(updated); setData(data.map(v => runAuditRules(v, updated))); }};
  const handleSaveRule = (e) => { e.preventDefault(); const updated = isEditingRule ? rules.map(r => r.id === currentRule.id ? currentRule : r) : [...rules, currentRule]; setRules(updated); setIsRuleModalOpen(false); setData(data.map(v => runAuditRules(v, updated))); };
  const handleSaveSql = (e) => { e.preventDefault(); const updated = sqlScripts.find(s=>s.id===currentSql.id) ? sqlScripts.map(s=>s.id===currentSql.id?currentSql:s) : [...sqlScripts, currentSql]; setSqlScripts(updated); setIsSqlModalOpen(false); };

  // --- Export ---
  // หมายเหตุ: CSV เป็นรายงานสำหรับวิเคราะห์ต่อใน Excel จึงใช้ UTF-8 + BOM (Excel เปิดไทยได้ถูกต้องทุก locale)
  const exportToCSV = () => {
    if (data.length === 0) return alert('ไม่มีข้อมูลสำหรับส่งออก');
    const headers = ["Status","Error","VN","InvNo","HN","Name","Amount","Dx"];
    const rows = filteredData.map(v => [v.status, v.errors.join(' '), v.SvID, v.InvNo, v.HN, `"${v.Name}"`, v.Amount, v.Code]);
    const csvContent = [headers, ...rows].map(e => e.join(",")).join("\n");
    const blob = new Blob(["﻿" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = `MBR_Audit_Report_${new Date().toISOString().slice(0,10)}.csv`; link.click();
  };

  /* ไฟล์ส่งเบิก สกส. (.txt) — windows-874 เสมอ
     รองรับทุกกรณีแก้ไข (CSOP '21' / SSOP '02'):
     - คง header ต้นฉบับ (PayPlan/SESSNO/HNAME) อัปเดตเฉพาะ RECCOUNT
     - จบไฟล์ด้วยลายเซ็น <?EndNote Checksum="MD5"?> ให้ สกส. รับได้ทันที */
  const exportToCSMBS = (type) => {
    if (data.some(v => v.isIPD)) alert('หมายเหตุ: ข้ามรายการผู้ป่วยใน (AIPN) เพราะไฟล์เซ็นด้วย HMAC ส่งออกซ้ำไม่ได้');
    const rows = data.filter(v => !v.isIPD); // ไฟล์ AIPN (ผู้ป่วยใน) ส่งออกซ้ำไม่ได้ — ตัดออก
    if (rows.length === 0) return alert('ไม่มีข้อมูล OPD สำหรับส่งออก');
    const fmt2 = (n) => (parseFloat(n) || 0).toFixed(2);
    const now = new Date().toISOString().slice(0, 19);
    const isCSOP = rows[0].RecType === '21';

    // header: ใช้ของไฟล์ต้นฉบับถ้ามี (คง PayPlan/SESSNO) — ไม่มีค่อยสร้างใหม่ตามสิทธิ
    const buildHeader = (count) => {
      const orig = rawHeaders[type];
      if (orig) return orig.replace(/<RECCOUNT>\d*<\/RECCOUNT>/, `<RECCOUNT>${count}</RECCOUNT>`);
      const plan = isCSOP ? 'PayPlan="CS"' : 'PayPlan="SS" Prgs="HX"';
      return `<?xml version="1.0" encoding="windows-874"?>\n<ClaimRec System="OP" ${plan} Version="0.93">\n<Header>\n<HCODE>40922</HCODE>\n<HNAME>ศูนย์การแพทย์มหิดลบำรุงรักษ์ จังหวัดนครสวรรค์ </HNAME>\n<DATETIME>${now}</DATETIME>\n<SESSNO>0001</SESSNO>\n<RECCOUNT>${count}</RECCOUNT>\n</Header>\n`;
    };

    let content = "";
    if (type === 'BILLTRAN') {
       content = buildHeader(rows.length) + `<BILLTRAN>\n`;
       rows.forEach(v => {
         content += `${v.RecType || '02'}||${v.DTTran}|${v.HCode}|${v.InvNo}|${v.BillNo}|${v.HN}|${v.MemberNo}|${fmt2(v.Amount)}|${fmt2(v.Paid)}|${v.VerCode}|${v.Tflag}|${v.PID}|${v.Name}|${v.HMain}|${v.PayPlan}|${fmt2(v.ClaimAmt)}|${v.SHFlag || ''}|${fmt2(v.OtherPay)}\n`;
       });
       content += `</BILLTRAN>\n<BillItems>\n`;
       rows.forEach(v => {
         v.items.forEach(it => { content += `${v.InvNo}|${it.SvDate}|${it.BillMu}|${it.LCCode}|${it.StdCode}|${it.Desc}|${it.Qty}|${fmt2(it.Up)}|${fmt2(it.ChargeAmt)}|${fmt2(it.ClaimUP)}|${fmt2(it.ClaimAmount)}|${it.SvRefID}|${it.ClaimCat}\n`; });
       });
       content += `</BillItems>\n</ClaimRec>\n`;
    } else if (type === 'OPServices') {
       content = buildHeader(rows.length) + `<OPServices>\n`;
       rows.forEach(v => { content += `${v.InvNo}|${v.SvID}|${v.Class}|${v.HCode}|${v.HN}|${v.PID}|${v.CareAccount}|${v.TypeServ}|${v.TypeIn}|${v.TypeOut}|${v.DTAppoint}|${v.SvPID}|${v.Clinic}|${v.BegDT}|${v.EndDT}|${v.LcCode}|${v.CodeSet}|${v.STDCode}|${fmt2(v.SvCharge)}|${v.Completion}|${v.SvTxCode}|${v.ClaimCat}\n`; });
       content += `</OPServices>\n<OPDx>\n`;
       rows.forEach(v => { v.dxList.forEach(dx => { content += `EC|${dx.SvID}|${dx.SL}|${dx.CodeSet}|${dx.Code}|${dx.Desc}\n`; }); });
       content += `</OPDx>\n</ClaimRec>\n`;
    } else if (type === 'BILLDISP') {
        content = buildHeader(rows.filter(v => v.dispensing).length) + `<Dispensing>\n`;
        rows.forEach(v => {
            if(v.dispensing) {
                const d = v.dispensing;
                content += `${d.ProviderID}|${d.DispID}|${v.InvNo}|${v.HN}|${v.PID}|${d.Prescdt}|${d.DispDT}|${d.Presc}|${d.Itemcnt}|${fmt2(d.ChargeAmt)}|${fmt2(d.ClaimAmt)}|${fmt2(d.Paid)}|${fmt2(d.OtherPay)}|${d.Reimburser}|${d.BenefitPlan}|${d.DispStat}|${v.SvID}|${d.DayCover}\n`;
            }
        });
        content += `</Dispensing>\n<DispensedItems>\n`;
        rows.forEach(v => {
            if(v.dispensedItems) {
                v.dispensedItems.forEach(it => {
                    content += `${it.DispID}|${it.PrdCat}|${it.HospDrgID}|${it.DrgID}|${it.dfsText}|${it.Packsize}|${it.sigCode}|${it.sigText}|${it.Quantity}|${fmt2(it.UnitPrice)}|${fmt2(it.ChargeAmt)}|${fmt2(it.ReimbPrice)}|${fmt2(it.ReimbAmt)}|${it.PrdSeCode}|${it.Claimcat}|${it.CodeSet}\n`;
                });
            }
        });
        content += `</DispensedItems>\n</ClaimRec>\n`;
    }

    // แปลงเป็น CRLF ตามไฟล์จริงของ สกส. แล้วเซ็น Checksum ปิดท้าย (ไม่มี newline ตามหลัง)
    content = content.replace(/\r?\n/g, '\r\n');
    const checksum = md5Hex(encodeWindows874(content));
    content += `<?EndNote Checksum="${checksum}"?>`;

    const d8 = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    downloadWin874(content, `${type}${d8}.txt`);
  };

  // --- Edit Handlers ---
  const handleEditChange = (f, v) => setEditFormData(p => ({...p, [f]: v}));
  const handleDxChange = (index, field, value) => { const newDx = editFormData.dxList.map((d, i) => i === index ? { ...d, [field]: value } : d); setEditFormData(prev => ({ ...prev, dxList: newDx })); };
  const addDx = () => setEditFormData(prev => ({ ...prev, dxList: [...prev.dxList, { Class: "OP", SvID: prev.SvID, SL: String(prev.dxList.length + 1), CodeSet: "ICD-10", Code: "", Desc: "" }] }));
  const removeDx = (index) => setEditFormData(prev => ({ ...prev, dxList: prev.dxList.filter((_, i) => i !== index) }));

  const handleItemChange = (index, field, value) => {
    const newItems = editFormData.items.map((it, i) => i === index ? { ...it, [field]: value } : it);
    if (field === 'Qty' || field === 'Up' || field === 'ClaimUP') {
      const qty = parseFloat(newItems[index].Qty || 0); const up = parseFloat(newItems[index].Up || 0);
      const claimUP = parseFloat(newItems[index].ClaimUP || 0);
      newItems[index].ChargeAmt = (qty * up).toFixed(2);
      newItems[index].ClaimAmount = (qty * (claimUP || up)).toFixed(2);
    }
    const total = newItems.reduce((acc, it) => acc + (parseFloat(it.ChargeAmt) || 0), 0);
    setEditFormData(prev => ({ ...prev, items: newItems, Amount: parseFloat(total.toFixed(2)), ClaimAmt: parseFloat(total.toFixed(2)) }));
  };

  // เพิ่ม/ลบ รายการค่ารักษา (BillItems)
  const addItem = () => setEditFormData(prev => ({
    ...prev,
    items: [...prev.items, {
      InvNo: prev.InvNo, SvDate: prev.BegDT || '', BillMu: '', LCCode: '', StdCode: '', Desc: '',
      Qty: 1, Up: 0, ChargeAmt: 0, ClaimUP: 0, ClaimAmount: 0, SvRefID: '', ClaimCat: ''
    }]
  }));
  const removeItem = (index) => setEditFormData(prev => {
    const newItems = prev.items.filter((_, i) => i !== index);
    const total = newItems.reduce((acc, it) => acc + (parseFloat(it.ChargeAmt) || 0), 0);
    return { ...prev, items: newItems, Amount: parseFloat(total.toFixed(2)), ClaimAmt: parseFloat(total.toFixed(2)) };
  });

  const handleDispChange = (field, value) => setEditFormData(prev => ({ ...prev, dispensing: { ...prev.dispensing, [field]: value } }));
  const handleDispItemChange = (index, field, value) => {
    const newItems = editFormData.dispensedItems.map((it, i) => i === index ? { ...it, [field]: value } : it);
    if (field === 'Quantity' || field === 'UnitPrice' || field === 'ReimbPrice') {
      const qty = parseFloat(newItems[index].Quantity || 0); const up = parseFloat(newItems[index].UnitPrice || 0);
      const reimb = parseFloat(newItems[index].ReimbPrice || 0);
      newItems[index].ChargeAmt = (qty * up).toFixed(2);
      newItems[index].ReimbAmt = (qty * (reimb || up)).toFixed(2);
    }
    const total = newItems.reduce((acc, it) => acc + (parseFloat(it.ChargeAmt) || 0), 0);
    setEditFormData(prev => ({ ...prev, dispensedItems: newItems, dispensing: { ...prev.dispensing, ChargeAmt: total.toFixed(2), ClaimAmt: total.toFixed(2) } }));
  };

  // เพิ่ม/ลบ รายการยา (DispensedItems)
  const addDispItem = () => setEditFormData(prev => ({
    ...prev,
    dispensing: prev.dispensing || {
      ProviderID: '', DispID: 'DISP' + Date.now(), Prescdt: prev.BegDT || '', DispDT: prev.BegDT || '', Presc: '',
      Itemcnt: 0, ChargeAmt: 0, ClaimAmt: 0, Paid: 0, OtherPay: 0, Reimburser: '', BenefitPlan: '', DispStat: '', SvID: prev.SvID, DayCover: ''
    },
    dispensedItems: [...(prev.dispensedItems || []), {
      DispID: (prev.dispensing && prev.dispensing.DispID) || 'DISP' + Date.now(),
      PrdCat: '', HospDrgID: '', DrgID: '', dfsText: '', Packsize: '', sigCode: '', sigText: '',
      Quantity: 1, UnitPrice: 0, ChargeAmt: 0, ReimbPrice: 0, ReimbAmt: 0, PrdSeCode: '', Claimcat: '', CodeSet: 'TMT'
    }]
  }));
  const removeDispItem = (index) => setEditFormData(prev => {
    const newItems = prev.dispensedItems.filter((_, i) => i !== index);
    const total = newItems.reduce((acc, it) => acc + (parseFloat(it.ChargeAmt) || 0), 0);
    return { ...prev, dispensedItems: newItems, dispensing: prev.dispensing ? { ...prev.dispensing, ChargeAmt: total.toFixed(2), ClaimAmt: total.toFixed(2) } : prev.dispensing };
  });

  // --- Bulk Edit (แก้ไขหลายรายการพร้อมกัน) ---
  const applyBulkEdit = () => {
    if (!bulkField) return alert('กรุณาเลือกฟิลด์ที่ต้องการแก้ไข');
    const targets = filteredData.map(v => v.InvNo);
    const updated = data.map(v => {
      if (!targets.includes(v.InvNo)) return v;
      return runAuditRules({ ...v, [bulkField]: bulkValue }, rules);
    });
    setData(updated);
    setIsBulkModalOpen(false);
    setUploadMessage(`แก้ไข ${bulkField} = "${bulkValue}" จำนวน ${targets.length} รายการแล้ว`);
    setTimeout(() => setUploadMessage(''), 5000);
  };

  const handleSaveChanges = () => {
    if (!editFormData.HN || !editFormData.SvID) return alert("ต้องระบุ HN และ SvID");
    const audited = runAuditRules(editFormData, rules);
    setData(prev => prev.map(d => d.InvNo === audited.InvNo ? audited : d));
    setSelectedVisit(audited); setIsEditMode(false);
  };

  // --- FILE PARSER ---
  const handleFileUpload = (event) => {
    const files = Array.from(event.target.files);
    if (files.length === 0) return;
    setIsLoading(true);
    setUploadMessage('กำลังอ่านไฟล์...');

    const fileContents = {};
    let filesRead = 0;
    const newLoaded = { BILLTRAN: false, OPServices: false, BILLDISP: false, CSV: false, AIPN: false };

    files.forEach(file => {
      const reader = new FileReader();
      reader.readAsText(file, 'windows-874'); // Thai encoding
      reader.onload = (e) => {
        const content = cleanString(e.target.result);
        const name = file.name.toUpperCase();
        if (name.includes('BILLTRAN')) { fileContents['BILLTRAN'] = content; newLoaded.BILLTRAN = true; }
        else if (name.includes('OPSERVICES')) { fileContents['OPServices'] = content; newLoaded.OPServices = true; }
        else if (name.includes('BILLDISP')) { fileContents['BILLDISP'] = content; newLoaded.BILLDISP = true; }
        else if (name.includes('AIPN') || content.includes('<CIPN>')) { fileContents['AIPN'] = content; newLoaded.AIPN = true; }
        else if (name.endsWith('.CSV')) { fileContents['CSV'] = content; newLoaded.CSV = true; }

        filesRead++;
        if (filesRead === files.length) {
          setLoadedFiles(newLoaded);
          processFiles(fileContents);
        }
      };
    });
  };

  const processFiles = (contents) => {
    try {
      setUploadMessage('กำลังประมวลผลข้อมูล...');
      let newData = [];

      // เก็บ header ต้นฉบับของแต่ละไฟล์ไว้ใช้ตอน export (คง PayPlan / SESSNO / HNAME เดิม)
      const grabHeader = (t) => { if (!t) return null; const m = t.match(/^[\s\S]*?<\/Header>\r?\n/); return m ? m[0].replace(/\r\n/g, '\n') : null; };
      setRawHeaders({
        BILLTRAN: grabHeader(contents['BILLTRAN']),
        OPServices: grabHeader(contents['OPServices']),
        BILLDISP: grabHeader(contents['BILLDISP'])
      });

      if (contents['AIPN']) {
         newData = parseAIPN(contents['AIPN']);
         if (contents['BILLTRAN'] || contents['OPServices'] || contents['BILLDISP']) {
            newData = newData.concat(parseCSMBS(contents['BILLTRAN'], contents['OPServices'], contents['BILLDISP']));
         }
      } else if (contents['BILLTRAN'] || contents['OPServices'] || contents['BILLDISP']) {
         newData = parseCSMBS(contents['BILLTRAN'], contents['OPServices'], contents['BILLDISP']);
      } else if (contents['CSV']) {
         alert("ยังไม่รองรับการนำเข้าไฟล์ CSV ในเวอร์ชันนี้ กรุณาใช้ไฟล์ Text สกส.");
         setIsLoading(false); return;
      } else {
         alert("กรุณาอัปโหลดไฟล์ข้อมูล (BILLTRAN, OPServices หรือ BILLDISP)");
         setIsLoading(false); return;
      }

      if (newData.length === 0) {
        alert("ไม่พบข้อมูลรายการในไฟล์ที่อัปโหลด กรุณาตรวจสอบรูปแบบไฟล์อีกครั้ง");
      }

      const auditedData = newData.map(v => runAuditRules(v, rules));
      setData(auditedData);
      setUploadMessage(`นำเข้าสำเร็จ: ${auditedData.length} รายการ`);
      setTimeout(() => setUploadMessage(''), 5000);
    } catch (e) {
      console.error(e);
      alert("เกิดข้อผิดพลาดในการอ่านไฟล์: " + e.message);
    } finally {
      setIsLoading(false);
      if(fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const parseCSMBS = (billTranText, opServicesText, billDispText) => {
    const visits = {};

    const getVisit = (invNo) => {
      if (!visits[invNo]) {
        visits[invNo] = {
          InvNo: invNo, SvID: '-', HCode: '-', HN: '-', PID: '-', Name: 'ไม่พบชื่อ',
          DTTran: '', Amount: 0, Paid: 0, PayPlan: '-', ClaimAmt: 0, BillAmt: 0,
          dxList: [], items: [], dispensing: null, dispensedItems: [],
          Clinic: '', CodeSet: '', STDCode: '', SvCharge: '', Completion: '', SvTxCode: '', ClaimCat: '',
          CareAccount: '', TypeServ: '', TypeIn: '', TypeOut: '', DTAppoint: '', SvPID: '', LcCode: '',
          BillNo: '', MemberNo: '', VerCode: '', Tflag: '', HMain: '', OtherPay: 0, Class: '', BegDT: '', EndDT: ''
        };
      }
      return visits[invNo];
    };

    /* BILLTRAN: ใช้การตรวจ Section (<BILLTRAN> / <BillItems>) แทนการเดารหัส cols[0]
       เพราะ record หลักของแต่ละสิทธิขึ้นต้นต่างกัน (CSOP='21', SS='02') */
    if (billTranText) {
      let section = '';
      const lines = billTranText.split(/\r?\n/);
      lines.forEach(line => {
        const t = line.trim();
        if (t.includes('<BILLTRAN>')) { section = 'MAIN'; return; }
        if (t.includes('<BillItems>')) { section = 'ITEMS'; return; }
        if (t.startsWith('<') || t === '') return;
        const cols = line.split('|').map(c => c.trim());
        if (cols.length < 5) return;

        if (section === 'MAIN') {
           const invNo = cols[4];
           if (invNo) {
             const v = getVisit(invNo);
             v.RecType = cols[0]; // '21' = CSOP (ข้าราชการ), '02' = SSOP (ประกันสังคม)
             v.HCode = cols[3]; v.BillNo = cols[5]; v.HN = cols[6]; v.MemberNo = cols[7];
             v.DTTran = cols[2]; v.Amount = parseFloat(cols[8]||0); v.Paid = parseFloat(cols[9]||0);
             v.VerCode = cols[10]; v.Tflag = cols[11]; v.PID = cols[12]; v.Name = cols[13] || 'ไม่พบชื่อ';
             v.HMain = cols[14]; v.PayPlan = cols[15];
             v.ClaimAmt = parseFloat(cols[16]||0); v.SHFlag = cols[17] || ''; v.OtherPay = parseFloat(cols[18]||0); v.BillAmt = parseFloat(cols[8]||0);
           }
        } else if (section === 'ITEMS') {
           const invNo = cols[0];
           if (invNo && /^\d+$/.test(invNo)) {
             const v = getVisit(invNo);
             v.items.push({
                InvNo: invNo, SvDate: cols[1], BillMu: cols[2], LCCode: cols[3], StdCode: cols[4], Desc: cols[5],
                Qty: parseFloat(cols[6]||0), Up: parseFloat(cols[7]||0), ChargeAmt: parseFloat(cols[8]||0),
                ClaimUP: parseFloat(cols[9]||0), ClaimAmount: parseFloat(cols[10]||0), SvRefID: cols[11], ClaimCat: cols[12]
             });
           }
        }
      });
    }

    if (opServicesText) {
      let section = '';
      const lines = opServicesText.split(/\r?\n/);
      const vnToInvMap = {};

      lines.forEach(line => {
        const t = line.trim();
        if (t.includes('<OPServices>')) { section = 'SERV'; return; }
        if (t.includes('<OPDx>')) { section = 'DX'; return; }
        if (t.startsWith('<') || t === '') return;
        const cols = line.split('|').map(c => c.trim());
        if (cols.length < 5) return;

        const col0 = cols[0];
        if (section === 'SERV' && /^\d+$/.test(col0)) {
           const invNo = col0;
           const v = getVisit(invNo);
           v.SvID = cols[1]; v.Class = cols[2]; v.HCode = cols[3]; v.HN = cols[4]; v.PID = cols[5];
           v.CareAccount = cols[6]; v.TypeServ = cols[7]; v.TypeIn = cols[8]; v.TypeOut = cols[9];
           v.DTAppoint = cols[10]; v.SvPID = cols[11]; v.Clinic = cols[12];
           v.BegDT = cols[13]; v.EndDT = cols[14]; v.LcCode = cols[15]; v.CodeSet = cols[16];
           v.STDCode = cols[17]; v.SvCharge = cols[18]; v.Completion = cols[19]; v.SvTxCode = cols[20]; v.ClaimCat = cols[21];
           vnToInvMap[cols[1]] = invNo;
        }
        else if (section === 'DX' && col0 === 'EC' && vnToInvMap[cols[1]]) {
           const invNo = vnToInvMap[cols[1]];
           if (visits[invNo]) {
             visits[invNo].dxList.push({
               Class: col0, SvID: cols[1], SL: cols[2], CodeSet: cols[3], Code: cols[4], Desc: cols[5] || ''
             });
           }
        }
      });
    }

    if (billDispText) {
       let currentSection = '';
       const lines = billDispText.split(/\r?\n/);
       lines.forEach(line => {
          const trimLine = line.trim();
          if (trimLine.includes('<Dispensing>')) { currentSection = 'Dispensing'; return; }
          else if (trimLine.includes('<DispensedItems>')) { currentSection = 'DispensedItems'; return; }
          else if (trimLine.startsWith('<')) return;

          const cols = line.split('|').map(c => c.trim());
          if (cols.length > 5) {
             if (currentSection === 'Dispensing') {
                const invNo = cols[2];
                if (invNo) {
                   const v = getVisit(invNo);
                   v.dispensing = {
                     ProviderID: cols[0], DispID: cols[1], Prescdt: cols[5], DispDT: cols[6], Presc: cols[7], Itemcnt: cols[8],
                     ChargeAmt: parseFloat(cols[9]||0), ClaimAmt: parseFloat(cols[10]||0), Paid: parseFloat(cols[11]||0),
                     OtherPay: parseFloat(cols[12]||0), Reimburser: cols[13], BenefitPlan: cols[14], DispStat: cols[15],
                     SvID: cols[16], DayCover: cols[17]
                   };
                   if(v.HN === '-') v.HN = cols[3];
                }
             } else if (currentSection === 'DispensedItems') {
                const dispID = cols[0];
                const visit = Object.values(visits).find(v => v.dispensing && v.dispensing.DispID === dispID);
                if (visit) {
                   visit.dispensedItems.push({
                      DispID: dispID, PrdCat: cols[1], HospDrgID: cols[2], DrgID: cols[3], dfsText: cols[4], Packsize: cols[5],
                      sigCode: cols[6], sigText: cols[7], Quantity: parseFloat(cols[8]||0), UnitPrice: parseFloat(cols[9]||0),
                      ChargeAmt: parseFloat(cols[10]||0), ReimbPrice: parseFloat(cols[11]||0), ReimbAmt: parseFloat(cols[12]||0),
                      PrdSeCode: cols[13], Claimcat: cols[14], CodeSet: cols[15]
                   });
                }
             }
          }
       });
    }

    return Object.values(visits);
  };

  /* ========================================================
     Parser สำหรับไฟล์ผู้ป่วยใน AIPN (โครงสร้าง <CIPN> XML)
     ⚠️ อ่านได้อย่างเดียว — ส่งออกซ้ำไม่ได้ เพราะท้ายไฟล์มี
     <?EndNote HMAC="..."> ที่เซ็นด้วย secret key (สร้างใหม่ไม่ได้)
     ======================================================== */
  const parseAIPN = (xmlText) => {
    const getSection = (tag) => {
      const m = xmlText.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
      return m ? m[1].trim() : '';
    };
    const dataLines = (block) => block.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('<'));

    const adt = dataLines(getSection('IPADT'))[0];
    if (!adt) return [];
    const a = adt.split('|').map(c => c.trim());

    const visit = {
      InvNo: a[0] || '-', SvID: a[0] || '-', HN: a[1] || '-', PID: a[3] || '-',
      Name: `${a[4] || ''}${a[5] || ''}`.trim() || 'ไม่พบชื่อ',
      HCode: getSection('Hcare') || '40922', HMain: getSection('Hmain') || '',
      Class: 'IPD', BegDT: a[14] || '', EndDT: a[15] || '',
      DTTran: a[14] || '', PayPlan: getSection('UPayPlan') || '', CareAccount: getSection('CareAs') || '',
      MemberNo: '', VerCode: '', Tflag: '', SvPID: '', Clinic: '', CodeSet: 'ICD-10',
      STDCode: '', SvCharge: '', Completion: '', SvTxCode: '', ClaimCat: '',
      TypeServ: 'IP', TypeIn: '', TypeOut: '', DTAppoint: '', LcCode: '', BillNo: '',
      Amount: 0, Paid: 0, ClaimAmt: 0, BillAmt: 0, OtherPay: 0,
      dxList: [], items: [], dispensing: null, dispensedItems: [],
      isIPD: true // ⚠️ AIPN — read-only, export ไม่ได้
    };

    dataLines(getSection('IPDx')).forEach(line => {
      const c = line.split('|').map(x => x.trim());
      visit.dxList.push({ Class: 'IP', SvID: visit.SvID, SL: c[1], CodeSet: c[2] || 'ICD-10', Code: c[3], Desc: c[4] || '' });
    });

    // BillItems ผู้ป่วยในอยู่ใน <Invoices> (คนละ layout กับ OPD)
    dataLines(getSection('BillItems')).forEach(line => {
      const c = line.split('|').map(x => x.trim());
      visit.items.push({
        InvNo: visit.InvNo, SvDate: c[1], BillMu: c[2], LCCode: c[12] || '', StdCode: c[13] || '', Desc: c[4],
        Qty: parseFloat(c[5] || 0), Up: parseFloat(c[6] || 0), ChargeAmt: parseFloat(c[7] || 0),
        ClaimUP: parseFloat(c[18] || 0), ClaimAmount: parseFloat(c[19] || 0), SvRefID: c[15] || '', ClaimCat: c[2] || ''
      });
    });
    visit.Amount = visit.items.reduce((s, it) => s + (it.ChargeAmt || 0), 0);
    visit.ClaimAmt = visit.Amount;
    visit.BillAmt = visit.Amount;

    return [visit];
  };

  return (
    <div className="flex h-screen bg-[#f8fafc] font-sans text-slate-800 selection:bg-[#F2A900]/30 selection:text-[#00246B]">
      {/* Sidebar - Light Theme */}
      <aside className="w-64 bg-white text-slate-700 flex flex-col shadow-[4px_0_24px_rgba(0,0,0,0.02)] z-20 border-r border-slate-100">
        <div className="p-6 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-50 rounded-xl">
              <ShieldCheck className="w-7 h-7 text-[#00246B]" />
            </div>
            <div>
              <h1 className="font-extrabold text-lg leading-tight tracking-wide text-[#00246B]">MBR Center</h1>
              <p className="text-[12px] text-[#F2A900] font-bold tracking-wider uppercase mt-0.5">Mahidol Bumrungrak</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 p-4 space-y-1.5 overflow-y-auto">
          <SidebarItem icon={<Activity />} label="หน้าหลักตรวจสอบ" active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} />
          <SidebarItem icon={<Settings />} label="ตั้งค่าเงื่อนไข" active={activeTab === 'rules'} onClick={() => setActiveTab('rules')} />
          <SidebarItem icon={<Database />} label="คลังคำสั่ง SQL" active={activeTab === 'sql'} onClick={() => setActiveTab('sql')} />
          <SidebarItem icon={<FileDown />} label="ส่งออกข้อมูล (Export)" active={activeTab === 'report'} onClick={() => setActiveTab('report')} />
          <div className="pt-2 mt-2 border-t border-slate-100">
            <button onClick={() => window.open('/cpap-fix', '_blank')} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl transition-all duration-200 outline-none text-slate-500 hover:bg-cyan-50 hover:text-cyan-600 font-medium border-l-4 border-transparent group">
              <Wind size={20} className="text-cyan-400 group-hover:text-cyan-600" />
              <span className="text-sm tracking-wide flex-1 text-left">แก้ไฟล์ CPAP</span>
              <ExternalLink size={14} className="text-slate-300 group-hover:text-cyan-500" />
            </button>
          </div>
        </nav>
        <div className="p-4 bg-slate-50 text-xs text-center text-slate-400 border-t border-slate-100">
          <div className="font-bold text-slate-500 mb-0.5">MBR Audit Center</div>
          v1.18.0 (Light Theme) <br/> HOSxP XE Connected
        </div>
      </aside>

      <main className="flex-1 overflow-auto flex flex-col">
        {/* Header Area */}
        <header className="bg-white/80 backdrop-blur-md border-b border-slate-200 px-8 py-5 flex flex-col md:flex-row justify-between items-center sticky top-0 z-10 gap-4 shadow-sm">
          <div className="flex-1">
            <h2 className="text-xl font-extrabold text-[#00246B] tracking-tight">
              {activeTab === 'dashboard' ? 'ระบบ Pre-Screen Audit ศูนย์การแพทย์มหิดลบำรุงรักษ์' :
               activeTab === 'report' ? 'เครื่องมือส่งออกข้อมูล (Data Export)' :
               activeTab === 'sql' ? 'คลังคำสั่ง SQL (SQL Script Manager)' : 'ตั้งค่าเงื่อนไขและกฎการตรวจสอบ'}
            </h2>
            <div className="flex flex-wrap items-center gap-3 mt-2">
               {activeTab === 'dashboard' && (
                  <div className="flex gap-2 text-xs font-bold px-3 py-1.5 bg-slate-50 rounded-md border border-slate-200 text-slate-500">
                      <span className={`flex items-center gap-1.5 ${loadedFiles.BILLTRAN ? 'text-[#00246B]' : 'text-slate-300'}`}>
                        <div className={`w-1.5 h-1.5 rounded-full ${loadedFiles.BILLTRAN ? 'bg-green-500' : 'bg-slate-300'}`}></div> BILLTRAN
                      </span>
                      <span className="text-slate-200">|</span>
                      <span className={`flex items-center gap-1.5 ${loadedFiles.OPServices ? 'text-[#00246B]' : 'text-slate-300'}`}>
                        <div className={`w-1.5 h-1.5 rounded-full ${loadedFiles.OPServices ? 'bg-green-500' : 'bg-slate-300'}`}></div> OPServices
                      </span>
                      <span className="text-slate-200">|</span>
                      <span className={`flex items-center gap-1.5 ${loadedFiles.BILLDISP ? 'text-[#00246B]' : 'text-slate-300'}`}>
                         <div className={`w-1.5 h-1.5 rounded-full ${loadedFiles.BILLDISP ? 'bg-green-500' : 'bg-slate-300'}`}></div> BILLDISP
                      </span>
                  </div>
              )}
               {uploadMessage && <span className="text-xs font-medium bg-blue-50 text-blue-700 px-3 py-1.5 rounded-md border border-blue-100 animate-pulse">{uploadMessage}</span>}
            </div>
          </div>
          <div className="flex items-center gap-3">
             <input type="file" accept=".csv,.txt,.xml" multiple ref={fileInputRef} onChange={handleFileUpload} className="hidden" />
             <button onClick={() => setShowHelp(true)} className="p-2.5 bg-white text-slate-400 hover:text-[#00246B] hover:bg-slate-50 rounded-lg transition-colors border border-slate-200 shadow-sm" title="คู่มือการใช้งาน">
               <HelpCircle className="w-5 h-5" />
             </button>
             <button onClick={() => fileInputRef.current.click()} disabled={isLoading} className="flex items-center gap-2 px-5 py-2.5 bg-white text-[#00246B] border border-[#00246B]/20 rounded-lg hover:bg-blue-50 hover:border-[#00246B]/40 shadow-sm transition-all font-bold active:scale-95 disabled:opacity-50">
              <FileCode className="w-5 h-5 text-[#F2A900]" /> {isLoading ? 'กำลังประมวลผล...' : 'นำเข้าข้อมูล (Import)'}
            </button>
          </div>
        </header>

        <div className="p-8">
          {/* Dashboard Tab */}
          {activeTab === 'dashboard' && (
            <div className="space-y-6">
              {data.some(v => v.isIPD) && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
                   <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                   <div className="text-sm text-amber-800">
                      <span className="font-bold">โหมดอ่านอย่างเดียว (ไฟล์ผู้ป่วยใน AIPN):</span> ตรวจสอบและดูข้อมูลได้ แต่ <span className="font-bold">ส่งออกซ้ำไม่ได้</span> เพราะไฟล์ AIPN เซ็นด้วยลายเซ็นดิจิทัล (HMAC) ที่ต้องใช้ระบบต้นทางสร้างใหม่เท่านั้น หากต้องแก้ กรุณาแก้ที่ HOSxP แล้วส่งออกไฟล์ใหม่
                   </div>
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <StatCard title="จำนวนผู้ป่วย" value={stats.total} sub="รายการ" icon={<Users className="w-7 h-7 text-blue-500" />} bg="bg-blue-50" />
                <StatCard title="ผ่านการตรวจสอบ" value={stats.passed} sub="รายการ" icon={<CheckCircle className="w-7 h-7 text-emerald-500" />} bg="bg-emerald-50" textColor="text-emerald-700" />
                <StatCard title="ติดเงื่อนไข" value={stats.failed} sub="รายการ" icon={<AlertTriangle className="w-7 h-7 text-rose-500" />} bg="bg-rose-50" textColor="text-rose-700" />
                <StatCard title="ยอดรวม" value={stats.totalAmount.toLocaleString()} sub="บาท" icon={<FileText className="w-7 h-7 text-[#F2A900]" />} bg="bg-[#F2A900]/10" textColor="text-slate-800" />
              </div>

              <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-white">
                   <div className="flex items-center gap-2 text-slate-700 font-bold text-lg">
                     <Filter className="w-5 h-5 text-slate-400" /> รายการตรวจสอบ
                     <span className="text-xs bg-slate-100 text-slate-600 px-2.5 py-0.5 rounded-full ml-2">{filteredData.length}</span>
                   </div>
                   <div className="flex items-center gap-3">
                     <button onClick={() => { if (data.length === 0) return alert('กรุณานำเข้าข้อมูลก่อน'); setBulkField(''); setBulkValue(''); setIsBulkModalOpen(true); }} className="flex items-center gap-2 px-4 py-2 bg-white text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 shadow-sm transition-all text-sm font-bold">
                       <Layers className="w-4 h-4" /> แก้หลายรายการ
                     </button>
                     <div className="relative">
                       <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" />
                       <input type="text" placeholder="ค้นหา HN, SvID..." className="pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 bg-slate-50 focus:bg-white transition-colors" value={filterText} onChange={(e) => setFilterText(e.target.value)} />
                     </div>
                   </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-slate-50 text-slate-500 font-bold uppercase text-[13px] tracking-wider border-b border-slate-200">
                      <tr><th className="px-6 py-4">SvID</th><th className="px-6 py-4">InvNo</th><th className="px-6 py-4">HN</th><th className="px-6 py-4">Name</th><th className="px-6 py-4 text-right">Amount</th><th className="px-6 py-4">Code (Dx)</th><th className="px-6 py-4">Status</th><th className="px-6 py-4 text-center">Action</th></tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredData.length > 0 ? filteredData.map((visit, idx) => (
                        <tr key={idx} onClick={() => { setEditFormData(visit); setSelectedVisit(visit); setIsEditMode(true); }} className="hover:bg-blue-50/50 transition-colors cursor-pointer group bg-white">
                          <td className="px-6 py-4 font-mono text-slate-600 font-medium">{visit.SvID}</td>
                          <td className="px-6 py-4 text-slate-400 text-xs font-mono">{visit.InvNo || '-'}</td>
                          <td className="px-6 py-4 font-mono font-medium text-[#00246B]">{visit.HN}</td>
                          <td className="px-6 py-4 font-medium text-slate-700">{visit.Name}</td>
                          <td className="px-6 py-4 text-right font-mono text-slate-600 font-medium">{visit.Amount.toLocaleString()}</td>
                          <td className="px-6 py-4 font-medium text-slate-600">
                             {visit.Code}
                             {visit.errors.length > 0 && <span className="inline-flex items-center justify-center px-1.5 py-0.5 ml-2 text-[12px] font-bold bg-rose-100 text-rose-600 rounded">+{visit.errors.length}</span>}
                          </td>
                          <td className="px-6 py-4">
                             <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${visit.status === 'PASS' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border border-rose-200'}`}>
                               {visit.status === 'PASS' ? <CheckCircle className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />} {visit.status}
                             </span>
                          </td>
                          <td className="px-6 py-4 text-center">
                             <button className="p-1.5 text-slate-300 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors">
                               <Edit2 className="w-4 h-4" />
                             </button>
                          </td>
                        </tr>
                      )) : <tr><td colSpan="8" className="px-6 py-12 text-center text-slate-400">ไม่พบข้อมูล (กดปุ่ม "นำเข้าข้อมูล" เพื่อเริ่มต้น)</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* Export Tab */}
          {activeTab === 'report' && (
             <div className="max-w-4xl mx-auto space-y-6">
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-10 text-center">
                   <div className="w-20 h-20 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-sm border border-blue-100"><FileDown className="w-10 h-10" /></div>
                   <h3 className="text-3xl font-extrabold text-slate-800 mb-3 tracking-tight">ส่งออกข้อมูลเพื่อเบิกจ่าย</h3>
                   <p className="text-slate-500 mb-6 max-w-lg mx-auto">ดาวน์โหลดข้อมูลที่ผ่านการตรวจสอบแล้วในรูปแบบ CSV สำหรับดูรายงาน หรือโครงสร้าง สกส. (TXT, windows-874) สำหรับนำไปเบิกจ่าย</p>
                   <div className="max-w-lg mx-auto mb-6 bg-emerald-50 border border-emerald-100 rounded-lg p-3 text-xs text-emerald-700 flex items-start gap-2 text-left">
                      <ShieldCheck className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <span>ไฟล์ สกส. ที่ส่งออกจะ<b>เซ็นลายเซ็น Checksum (MD5)</b> ท้ายไฟล์อัตโนมัติ และคง PayPlan/SESSNO จากไฟล์ต้นฉบับ — รองรับทั้ง CSOP (ข้าราชการ) และ SSOP (ประกันสังคม) ส่งกลับเข้าโปรแกรม สกส. ได้ทันทีทุกกรณีแก้ไข</span>
                   </div>

                   <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mt-8">
                      <ExportBtn icon={<FileText />} color="emerald" title="รายงาน CSV" onClick={exportToCSV} />
                      <ExportBtn icon={<FileDigit />} color="navy" title="BILLTRAN" onClick={() => exportToCSMBS('BILLTRAN')} />
                      <ExportBtn icon={<Users />} color="navy" title="OPServices" onClick={() => exportToCSMBS('OPServices')} />
                      <ExportBtn icon={<Pill />} color="navy" title="BILLDISP" onClick={() => exportToCSMBS('BILLDISP')} />
                   </div>
                </div>
             </div>
          )}

          {/* SQL Scripts Tab */}
          {activeTab === 'sql' && (
            <div className="max-w-5xl mx-auto space-y-6">
              <div className="flex justify-between items-end mb-6">
                 <div>
                   <h3 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                     <Database className="w-7 h-7 text-blue-500" /> คลังคำสั่ง SQL
                   </h3>
                   <p className="text-slate-500 text-sm mt-2">จัดเก็บและคัดลอกคำสั่งที่ใช้ดึงข้อมูลจากฐานข้อมูล HOSxP</p>
                 </div>
                 <button onClick={() => { setCurrentSql({ id: Date.now().toString(), title: '', desc: '', code: '' }); setIsSqlModalOpen(true); }} className="flex items-center gap-2 px-5 py-2.5 bg-white text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 shadow-sm transition-all text-sm font-bold">
                   <Plus className="w-4 h-4" /> เพิ่มคำสั่งใหม่
                 </button>
              </div>
              <div className="grid grid-cols-1 gap-6">
                 {sqlScripts.map(script => (
                   <div key={script.id} className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden flex flex-col">
                      <div className="p-5 border-b border-slate-100 bg-white flex justify-between items-start">
                         <div>
                            <h4 className="font-bold text-slate-800 text-lg mb-1">{script.title}</h4>
                            <p className="text-sm text-slate-500">{script.desc}</p>
                         </div>
                         <div className="flex gap-2">
                            <button onClick={() => copyToClipboard(script.code)} className="flex items-center gap-1.5 px-4 py-2 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg transition-colors font-bold text-xs"><Copy className="w-4 h-4" /> คัดลอก</button>
                            <button onClick={() => { setCurrentSql({...script}); setIsSqlModalOpen(true); }} className="p-2 text-slate-400 hover:text-blue-500 bg-white border border-slate-200 rounded-lg shadow-sm transition-colors"><Edit2 className="w-4 h-4" /></button>
                            <button onClick={() => { if(window.confirm('ลบคำสั่งนี้?')) setSqlScripts(sqlScripts.filter(s=>s.id!==script.id)); }} className="p-2 text-slate-400 hover:text-rose-500 bg-white border border-slate-200 rounded-lg shadow-sm transition-colors"><Trash2 className="w-4 h-4" /></button>
                         </div>
                      </div>
                      <div className="p-0 bg-slate-50 overflow-x-auto relative border-t border-slate-100">
                         <div className="absolute top-2 right-4 text-slate-400 text-[12px] font-mono tracking-widest uppercase">PostgreSQL</div>
                         <pre className="text-blue-800 text-sm font-mono p-5 leading-relaxed"><code>{script.code}</code></pre>
                      </div>
                   </div>
                 ))}
              </div>
            </div>
          )}

          {/* Rules Configuration Tab */}
          {activeTab === 'rules' && (
            <div className="max-w-4xl mx-auto space-y-8">
               <div className="flex justify-between items-end mb-2">
                  <div>
                    <h3 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                      <Settings className="w-7 h-7 text-slate-400" /> ตั้งค่ากฎการตรวจสอบ
                    </h3>
                    <p className="text-slate-500 text-sm mt-2">เปิด/ปิด หรือเพิ่มเงื่อนไขการตรวจสอบ การเปลี่ยนแปลงมีผลทันที</p>
                  </div>
                  <button onClick={() => { setCurrentRule({ id: '', category: 'C_ERROR', label: '', desc: '', active: true, severity: 'Critical', sql: '' }); setIsEditingRule(false); setIsRuleModalOpen(true); }} className="flex items-center gap-2 bg-white text-blue-600 border border-blue-200 px-5 py-2.5 rounded-lg text-sm font-bold hover:bg-blue-50 shadow-sm transition-all">
                    <Plus className="w-4 h-4" /> เพิ่มกฎใหม่
                  </button>
               </div>

                {/* C-Error Rules */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                  <h4 className="font-bold text-slate-700 flex items-center gap-2 mb-5 border-b border-slate-100 pb-3 text-lg">
                    <AlertTriangle className="w-5 h-5 text-rose-500" /> กฎตรวจสอบติด C (C-Error)
                  </h4>
                  <div className="space-y-3">
                    {rules.filter(r => r.category === 'C_ERROR' || !r.category).map((rule) => (
                      <RuleRow key={rule.id} rule={rule} onToggle={toggleRule} onEdit={() => { setCurrentRule({...rule}); setIsEditingRule(true); setIsRuleModalOpen(true); }} onDelete={() => handleDeleteRule(rule.id)} />
                    ))}
                  </div>
                </div>

                {/* Local Rules */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                  <h4 className="font-bold text-slate-700 flex items-center gap-2 mb-5 border-b border-slate-100 pb-3 text-lg">
                    <ShieldCheck className="w-5 h-5 text-blue-500" /> เงื่อนไขศูนย์การแพทย์ (Local Rules)
                  </h4>
                  <div className="space-y-3">
                    {rules.filter(r => r.category === 'LOCAL_RULE').map((rule) => (
                      <RuleRow key={rule.id} rule={rule} onToggle={toggleRule} onEdit={() => { setCurrentRule({...rule}); setIsEditingRule(true); setIsRuleModalOpen(true); }} onDelete={() => handleDeleteRule(rule.id)} />
                    ))}
                  </div>
                </div>
            </div>
          )}
        </div>
      </main>

      {/* --- CHI EDITOR MODAL --- */}
      {isEditMode && editFormData && (
        <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl h-[95vh] flex flex-col overflow-hidden border border-slate-200">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-white rounded-t-2xl shrink-0">
              <h3 className="text-xl font-extrabold text-slate-800 flex items-center gap-2 tracking-tight">
                <Edit2 className="w-5 h-5 text-blue-500" /> แก้ไขข้อมูลผู้ป่วย (CHI Data Editor)
              </h3>
              <button onClick={() => setIsEditMode(false)} className="p-2 text-slate-400 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"><X className="w-6 h-6" /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
                 <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                    {/* Section 1 */}
                    <div className="space-y-4 border border-slate-200 p-5 rounded-xl bg-white shadow-sm hover:border-blue-200 transition-colors">
                       <h4 className="font-bold text-slate-700 flex items-center gap-2 border-b border-slate-50 pb-3"><Users className="w-5 h-5 text-blue-500" /> 1. OPServices</h4>
                       <div className="grid grid-cols-4 gap-3">
                          <Input label="InvNo (Key)" field="InvNo" data={editFormData} onChange={handleEditChange} />
                          <Input label="SvID (VN)" field="SvID" data={editFormData} onChange={handleEditChange} readOnly bg="bg-slate-50 text-slate-500 font-mono" />
                          <Input label="HN" field="HN" data={editFormData} onChange={handleEditChange} font="font-mono text-blue-600 font-bold" />
                          <Input label="BegDT" field="BegDT" data={editFormData} onChange={handleEditChange} />
                          <Input label="Class" field="Class" data={editFormData} onChange={handleEditChange} />
                          <Input label="HCode" field="HCode" data={editFormData} onChange={handleEditChange} />
                          <Input label="PID" field="PID" data={editFormData} onChange={handleEditChange} />
                          <Input label="CareAccount" field="CareAccount" data={editFormData} onChange={handleEditChange} />
                          <Input label="TypeServ" field="TypeServ" data={editFormData} onChange={handleEditChange} />
                          <Input label="TypeIn" field="TypeIn" data={editFormData} onChange={handleEditChange} />
                          <Input label="TypeOut" field="TypeOut" data={editFormData} onChange={handleEditChange} />
                          <Input label="DTAppoint" field="DTAppoint" data={editFormData} onChange={handleEditChange} />
                          <Input label="SvPID" field="SvPID" data={editFormData} onChange={handleEditChange} />
                          <Input label="Clinic" field="Clinic" data={editFormData} onChange={handleEditChange} />
                          <Input label="EndDT" field="EndDT" data={editFormData} onChange={handleEditChange} />
                          <Input label="LcCode" field="LcCode" data={editFormData} onChange={handleEditChange} />
                          <Input label="CodeSet" field="CodeSet" data={editFormData} onChange={handleEditChange} />
                          <Input label="STDCode" field="STDCode" data={editFormData} onChange={handleEditChange} />
                          <Input label="SvCharge" field="SvCharge" data={editFormData} onChange={handleEditChange} type="number" />
                          <Input label="Completion" field="Completion" data={editFormData} onChange={handleEditChange} />
                          <Input label="SvTxCode" field="SvTxCode" data={editFormData} onChange={handleEditChange} />
                          <Input label="ClaimCat" field="ClaimCat" data={editFormData} onChange={handleEditChange} />
                       </div>
                    </div>

                    {/* Section 2 */}
                    <div className="space-y-4 border border-slate-200 p-5 rounded-xl bg-white shadow-sm hover:border-blue-200 transition-colors">
                       <h4 className="font-bold text-slate-700 flex items-center gap-2 border-b border-slate-50 pb-3"><FileDigit className="w-5 h-5 text-indigo-500" /> 2. BILLTRAN</h4>
                       <div className="grid grid-cols-4 gap-3">
                          <Input label="Name" field="Name" data={editFormData} onChange={handleEditChange} span="col-span-2" font="font-bold text-slate-800" />
                          <Input label="Amount" field="Amount" data={editFormData} onChange={handleEditChange} type="number" font="font-bold text-blue-600" bg="bg-blue-50/50" />
                          <Input label="ClaimAmt" field="ClaimAmt" data={editFormData} onChange={handleEditChange} type="number" font="font-bold text-emerald-600" bg="bg-emerald-50/50" />
                          <Input label="DTTran" field="DTTran" data={editFormData} onChange={handleEditChange} span="col-span-2" />
                          <Input label="BillNo" field="BillNo" data={editFormData} onChange={handleEditChange} span="col-span-2" />
                          <Input label="MemberNo" field="MemberNo" data={editFormData} onChange={handleEditChange} span="col-span-2" />
                          <Input label="Paid" field="Paid" data={editFormData} onChange={handleEditChange} type="number" />
                          <Input label="VerCode" field="VerCode" data={editFormData} onChange={handleEditChange} />
                          <Input label="Tflag" field="Tflag" data={editFormData} onChange={handleEditChange} />
                          <Input label="HMain" field="HMain" data={editFormData} onChange={handleEditChange} />
                          <Input label="PayPlan" field="PayPlan" data={editFormData} onChange={handleEditChange} />
                          <Input label="OtherPay" field="OtherPay" data={editFormData} onChange={handleEditChange} type="number" span="col-span-2" />
                       </div>
                    </div>

                    {/* Section 3 */}
                    <div className="col-span-1 xl:col-span-2 border border-slate-200 p-5 rounded-xl bg-white shadow-sm hover:border-blue-200 transition-colors">
                       <div className="flex justify-between items-center border-b border-slate-50 pb-3 mb-4">
                          <h4 className="font-bold text-slate-700 flex items-center gap-2"><Syringe className="w-5 h-5 text-purple-500" /> 3. OPDx</h4>
                          <button onClick={addDx} className="text-xs font-bold bg-slate-50 text-slate-600 px-3 py-1.5 rounded-md border border-slate-200 hover:bg-slate-100 transition-colors flex items-center gap-1"><Plus className="w-3.5 h-3.5"/> เพิ่ม Dx</button>
                       </div>
                       <table className="w-full text-sm text-left border-collapse">
                          <thead className="text-[12px] text-slate-400 bg-slate-50 uppercase tracking-wider border-y border-slate-100">
                            <tr><th className="px-3 py-2 w-14">SL</th><th className="px-3 py-2 w-28">Code</th><th className="px-3 py-2">Desc</th><th className="px-3 py-2 w-24">CodeSet</th><th className="px-3 py-2 w-12 text-center">ลบ</th></tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {editFormData.dxList && editFormData.dxList.map((dx, i) => (
                              <tr key={i} className="group">
                                <td className="p-1.5"><input value={dx.SL} onChange={e=>handleDxChange(i,'SL',e.target.value)} className="w-full text-xs border border-slate-200 rounded p-1.5 text-center focus:ring-1 focus:ring-blue-400 outline-none transition-shadow" /></td>
                                <td className="p-1.5"><input value={dx.Code} onChange={e=>handleDxChange(i,'Code',e.target.value)} className="w-full text-xs border border-slate-200 rounded p-1.5 font-bold font-mono focus:ring-1 focus:ring-blue-400 outline-none uppercase transition-shadow" /></td>
                                <td className="p-1.5"><input value={dx.Desc} onChange={e=>handleDxChange(i,'Desc',e.target.value)} className="w-full text-xs border border-slate-200 rounded p-1.5 focus:ring-1 focus:ring-blue-400 outline-none transition-shadow" /></td>
                                <td className="p-1.5"><input value={dx.CodeSet} onChange={e=>handleDxChange(i,'CodeSet',e.target.value)} className="w-full text-xs border border-slate-200 rounded p-1.5 font-mono focus:ring-1 focus:ring-blue-400 outline-none transition-shadow" placeholder="ICD-10" /></td>
                                <td className="p-1.5 text-center"><button onClick={()=>removeDx(i)} className="text-slate-300 hover:text-rose-500 transition-colors p-1"><Trash2 className="w-4 h-4"/></button></td>
                              </tr>
                            ))}
                          </tbody>
                       </table>
                    </div>

                    {/* Section 4 */}
                    <div className="col-span-1 xl:col-span-2 border border-slate-200 p-5 rounded-xl bg-white shadow-sm hover:border-blue-200 transition-colors">
                       <div className="flex justify-between items-center border-b border-slate-50 pb-3 mb-4">
                          <h4 className="font-bold text-slate-700 flex items-center gap-2"><LayoutList className="w-5 h-5 text-teal-500" /> 4. BillItems</h4>
                          <button onClick={addItem} className="text-xs font-bold bg-slate-50 text-slate-600 px-3 py-1.5 rounded-md border border-slate-200 hover:bg-slate-100 transition-colors flex items-center gap-1"><Plus className="w-3.5 h-3.5"/> เพิ่มรายการ</button>
                       </div>
                       <div className="overflow-x-auto">
                          <table className="text-sm text-left border-collapse" style={{minWidth:'1100px'}}>
                             <thead className="text-[12px] text-slate-400 bg-slate-50 uppercase tracking-wider border-y border-slate-100">
                                <tr>
                                   <th className="px-2 py-2 w-24">SvDate</th>
                                   <th className="px-2 py-2 w-16">BillMu</th>
                                   <th className="px-2 py-2 w-20">LCCode</th>
                                   <th className="px-2 py-2 w-32">StdCode <span className="text-rose-500">*</span></th>
                                   <th className="px-2 py-2">Desc</th>
                                   <th className="px-2 py-2 text-right w-16">Qty</th>
                                   <th className="px-2 py-2 text-right w-22">UP</th>
                                   <th className="px-2 py-2 text-right w-22">ClaimUP</th>
                                   <th className="px-2 py-2 text-right w-24 bg-slate-100/50">ChargeAmt<br/><span className="normal-case text-[11px] text-slate-300">(auto)</span></th>
                                   <th className="px-2 py-2 text-right w-24 bg-blue-50/50">ClaimAmt<br/><span className="normal-case text-[11px] text-blue-300">(auto)</span></th>
                                   <th className="px-2 py-2 w-28">SvRefID</th>
                                   <th className="px-2 py-2 w-20">ClaimCat</th>
                                   <th className="px-2 py-2 w-10 text-center">ลบ</th>
                                </tr>
                             </thead>
                             <tbody className="divide-y divide-slate-100">
                                {editFormData.items && editFormData.items.map((item, i) => (
                                   <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                                      <td className="p-1"><input value={item.SvDate||''} onChange={e=>handleItemChange(i,'SvDate',e.target.value)} className="w-full text-xs border border-slate-200 rounded p-1.5 font-mono focus:ring-1 focus:ring-blue-400 outline-none" /></td>
                                      <td className="p-1"><input value={item.BillMu||''} onChange={e=>handleItemChange(i,'BillMu',e.target.value)} className="w-full text-xs border border-slate-200 rounded p-1.5 text-center font-bold focus:ring-1 focus:ring-blue-400 outline-none" /></td>
                                      <td className="p-1"><input value={item.LCCode||''} onChange={e=>handleItemChange(i,'LCCode',e.target.value)} className="w-full text-xs border border-slate-200 rounded p-1.5 font-mono focus:ring-1 focus:ring-blue-400 outline-none" /></td>
                                      <td className="p-1"><input value={item.StdCode||''} onChange={e=>handleItemChange(i,'StdCode',e.target.value)} className={`w-full text-xs border rounded p-1.5 font-mono focus:ring-1 focus:ring-blue-400 outline-none ${!item.StdCode && item.BillMu !== 'G' ? 'border-rose-300 bg-rose-50 focus:ring-rose-400' : 'border-slate-200'}`} /></td>
                                      <td className="p-1"><input value={item.Desc||''} onChange={e=>handleItemChange(i,'Desc',e.target.value)} className="w-full text-xs border border-slate-200 rounded p-1.5 focus:ring-1 focus:ring-blue-400 outline-none" /></td>
                                      <td className="p-1"><input type="number" value={item.Qty} onChange={e=>handleItemChange(i,'Qty',e.target.value)} className="w-full text-xs border border-slate-200 rounded p-1.5 text-right focus:ring-1 focus:ring-blue-400 outline-none" /></td>
                                      <td className="p-1"><input type="number" value={item.Up} onChange={e=>handleItemChange(i,'Up',e.target.value)} className="w-full text-xs border border-slate-200 rounded p-1.5 text-right focus:ring-1 focus:ring-blue-400 outline-none" /></td>
                                      <td className="p-1"><input type="number" value={item.ClaimUP||0} onChange={e=>handleItemChange(i,'ClaimUP',e.target.value)} className="w-full text-xs border border-slate-200 rounded p-1.5 text-right focus:ring-1 focus:ring-indigo-400 outline-none" /></td>
                                      <td className="p-1 bg-slate-50/30"><input type="number" value={item.ChargeAmt} readOnly className="w-full text-xs border border-transparent rounded p-1.5 text-right bg-transparent font-bold text-slate-700" /></td>
                                      <td className="p-1 bg-blue-50/20"><input type="number" value={item.ClaimAmount||0} readOnly className="w-full text-xs border border-transparent rounded p-1.5 text-right bg-transparent font-bold text-blue-700" /></td>
                                      <td className="p-1"><input value={item.SvRefID||''} onChange={e=>handleItemChange(i,'SvRefID',e.target.value)} className="w-full text-xs border border-slate-200 rounded p-1.5 font-mono focus:ring-1 focus:ring-blue-400 outline-none" /></td>
                                      <td className="p-1"><input value={item.ClaimCat||''} onChange={e=>handleItemChange(i,'ClaimCat',e.target.value)} className="w-full text-xs border border-slate-200 rounded p-1.5 text-center focus:ring-1 focus:ring-blue-400 outline-none" /></td>
                                      <td className="p-1 text-center"><button onClick={()=>removeItem(i)} className="text-slate-300 hover:text-rose-500 transition-colors p-1"><Trash2 className="w-4 h-4"/></button></td>
                                   </tr>
                                ))}
                             </tbody>
                          </table>
                       </div>
                    </div>

                    {/* Section 5 */}
                    {editFormData.dispensing && (
                      <div className="col-span-1 xl:col-span-2 border border-slate-200 p-5 rounded-xl bg-white shadow-sm hover:border-blue-200 transition-colors">
                        <div className="flex justify-between items-center border-b border-slate-50 pb-3 mb-4">
                           <h4 className="font-bold text-slate-700 flex items-center gap-2"><Pill className="w-5 h-5 text-pink-500" /> 5. ข้อมูลการจ่ายยา (BILLDISP)</h4>
                           <button onClick={addDispItem} className="text-xs font-bold bg-slate-50 text-slate-600 px-3 py-1.5 rounded-md border border-slate-200 hover:bg-slate-100 transition-colors flex items-center gap-1"><Plus className="w-3.5 h-3.5"/> เพิ่มยา</button>
                        </div>
                        <div className="grid grid-cols-4 lg:grid-cols-6 gap-3 mb-6 bg-slate-50/50 p-4 rounded-xl border border-slate-100">
                            <Input label="DispID" field="DispID" data={editFormData.dispensing} onChange={(f,v) => handleDispChange(f,v)} readOnly bg="bg-slate-100 text-slate-500 font-mono" />
                            <Input label="Prescdt" field="Prescdt" data={editFormData.dispensing} onChange={(f,v) => handleDispChange(f,v)} span="col-span-2" />
                            <Input label="DispDT" field="DispDT" data={editFormData.dispensing} onChange={(f,v) => handleDispChange(f,v)} span="col-span-2" />
                            <Input label="Presc" field="Presc" data={editFormData.dispensing} onChange={(f,v) => handleDispChange(f,v)} />
                            <Input label="ChargeAmt" field="ChargeAmt" data={editFormData.dispensing} onChange={(f,v) => handleDispChange(f,v)} type="number" font="font-bold text-amber-600" />
                            <Input label="ProviderID" field="ProviderID" data={editFormData.dispensing} onChange={(f,v) => handleDispChange(f,v)} />
                            <Input label="Itemcnt" field="Itemcnt" data={editFormData.dispensing} onChange={(f,v) => handleDispChange(f,v)} />
                            <Input label="Paid" field="Paid" data={editFormData.dispensing} onChange={(f,v) => handleDispChange(f,v)} type="number" />
                            <Input label="OtherPay" field="OtherPay" data={editFormData.dispensing} onChange={(f,v) => handleDispChange(f,v)} type="number" />
                            <Input label="Reimburser" field="Reimburser" data={editFormData.dispensing} onChange={(f,v) => handleDispChange(f,v)} />
                            <Input label="BenefitPlan" field="BenefitPlan" data={editFormData.dispensing} onChange={(f,v) => handleDispChange(f,v)} />
                            <Input label="DispStat" field="DispStat" data={editFormData.dispensing} onChange={(f,v) => handleDispChange(f,v)} />
                            <Input label="DayCover" field="DayCover" data={editFormData.dispensing} onChange={(f,v) => handleDispChange(f,v)} />
                        </div>
                        <div className="overflow-x-auto">
                            <table className="text-sm text-left border-collapse" style={{minWidth:'1400px'}}>
                              <thead className="text-[12px] text-slate-400 bg-slate-50 uppercase tracking-wider border-y border-slate-100">
                                  <tr>
                                    <th className="px-2 py-2 w-16">PrdCat</th>
                                    <th className="px-2 py-2 w-28">HospDrgID</th>
                                    <th className="px-2 py-2 w-44">DrgID (24หลัก) <span className="text-rose-500">*</span></th>
                                    <th className="px-2 py-2 w-40">dfsText</th>
                                    <th className="px-2 py-2 w-20">Packsize</th>
                                    <th className="px-2 py-2 w-20">sigCode</th>
                                    <th className="px-2 py-2 w-40">sigText</th>
                                    <th className="px-2 py-2 text-right w-16">Qty</th>
                                    <th className="px-2 py-2 text-right w-20">UP</th>
                                    <th className="px-2 py-2 text-right w-24 bg-slate-100/50">ChargeAmt<br/><span className="normal-case text-[11px] text-slate-300">(auto)</span></th>
                                    <th className="px-2 py-2 text-right w-22">ReimbPrice</th>
                                    <th className="px-2 py-2 text-right w-24 bg-amber-50/50">ReimbAmt<br/><span className="normal-case text-[11px] text-amber-300">(auto)</span></th>
                                    <th className="px-2 py-2 w-20">PrdSeCode</th>
                                    <th className="px-2 py-2 w-20">Claimcat</th>
                                    <th className="px-2 py-2 w-20">CodeSet</th>
                                    <th className="px-2 py-2 w-10 text-center">ลบ</th>
                                  </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                  {editFormData.dispensedItems && editFormData.dispensedItems.map((item, i) => (
                                    <tr key={i} className="hover:bg-slate-50/50 transition-colors">
                                        <td className="p-1"><input value={item.PrdCat||''} onChange={e=>handleDispItemChange(i,'PrdCat',e.target.value)} className="w-full text-xs border border-slate-200 rounded p-1.5 text-center font-bold focus:ring-1 focus:ring-blue-400 outline-none" /></td>
                                        <td className="p-1"><input value={item.HospDrgID||''} onChange={e=>handleDispItemChange(i,'HospDrgID',e.target.value)} className="w-full text-xs border border-slate-200 rounded p-1.5 font-mono focus:ring-1 focus:ring-blue-400 outline-none" /></td>
                                        <td className="p-1"><input value={item.DrgID||''} onChange={e=>handleDispItemChange(i,'DrgID',e.target.value)} className={`w-full text-xs border rounded p-1.5 font-mono focus:ring-1 focus:ring-blue-400 outline-none ${!item.DrgID ? 'border-rose-300 bg-rose-50 focus:ring-rose-400' : 'border-slate-200'}`} /></td>
                                        <td className="p-1"><input value={item.dfsText||''} onChange={e=>handleDispItemChange(i,'dfsText',e.target.value)} className="w-full text-xs border border-slate-200 rounded p-1.5 focus:ring-1 focus:ring-blue-400 outline-none" /></td>
                                        <td className="p-1"><input value={item.Packsize||''} onChange={e=>handleDispItemChange(i,'Packsize',e.target.value)} className="w-full text-xs border border-slate-200 rounded p-1.5 text-center focus:ring-1 focus:ring-blue-400 outline-none" /></td>
                                        <td className="p-1"><input value={item.sigCode||''} onChange={e=>handleDispItemChange(i,'sigCode',e.target.value)} className="w-full text-xs border border-slate-200 rounded p-1.5 font-mono focus:ring-1 focus:ring-blue-400 outline-none" /></td>
                                        <td className="p-1"><input value={item.sigText||''} onChange={e=>handleDispItemChange(i,'sigText',e.target.value)} className="w-full text-xs border border-slate-200 rounded p-1.5 focus:ring-1 focus:ring-blue-400 outline-none" title={item.sigText} /></td>
                                        <td className="p-1"><input type="number" value={item.Quantity} onChange={e=>handleDispItemChange(i,'Quantity',e.target.value)} className="w-full text-xs border border-slate-200 rounded p-1.5 text-right focus:ring-1 focus:ring-blue-400 outline-none" /></td>
                                        <td className="p-1"><input type="number" value={item.UnitPrice} onChange={e=>handleDispItemChange(i,'UnitPrice',e.target.value)} className="w-full text-xs border border-slate-200 rounded p-1.5 text-right focus:ring-1 focus:ring-blue-400 outline-none" /></td>
                                        <td className="p-1 bg-slate-50/30"><input type="number" value={item.ChargeAmt} readOnly className="w-full text-xs border border-transparent rounded p-1.5 text-right bg-transparent font-bold text-slate-700" /></td>
                                        <td className="p-1"><input type="number" value={item.ReimbPrice||0} onChange={e=>handleDispItemChange(i,'ReimbPrice',e.target.value)} className="w-full text-xs border border-slate-200 rounded p-1.5 text-right focus:ring-1 focus:ring-amber-400 outline-none" /></td>
                                        <td className="p-1 bg-amber-50/20"><input type="number" value={item.ReimbAmt||0} readOnly className="w-full text-xs border border-transparent rounded p-1.5 text-right bg-transparent font-bold text-amber-700" /></td>
                                        <td className="p-1"><input value={item.PrdSeCode||''} onChange={e=>handleDispItemChange(i,'PrdSeCode',e.target.value)} className="w-full text-xs border border-slate-200 rounded p-1.5 font-mono focus:ring-1 focus:ring-blue-400 outline-none" /></td>
                                        <td className="p-1"><input value={item.Claimcat||''} onChange={e=>handleDispItemChange(i,'Claimcat',e.target.value)} className="w-full text-xs border border-slate-200 rounded p-1.5 text-center focus:ring-1 focus:ring-blue-400 outline-none" /></td>
                                        <td className="p-1"><input value={item.CodeSet||''} onChange={e=>handleDispItemChange(i,'CodeSet',e.target.value)} className="w-full text-xs border border-slate-200 rounded p-1.5 font-mono focus:ring-1 focus:ring-blue-400 outline-none" /></td>
                                        <td className="p-1 text-center"><button onClick={()=>removeDispItem(i)} className="text-slate-300 hover:text-rose-500 transition-colors p-1"><Trash2 className="w-4 h-4"/></button></td>
                                    </tr>
                                  ))}
                              </tbody>
                            </table>
                        </div>
                      </div>
                    )}

                    {/* Section 5 — กรณียังไม่มีข้อมูลจ่ายยา */}
                    {!editFormData.dispensing && (
                      <div className="col-span-1 xl:col-span-2 border border-dashed border-slate-200 p-5 rounded-xl bg-slate-50/50 flex items-center justify-between">
                         <div className="flex items-center gap-2 text-slate-500">
                            <Pill className="w-5 h-5 text-slate-300" />
                            <span className="text-sm font-medium">visit นี้ยังไม่มีข้อมูลการจ่ายยา (BILLDISP)</span>
                         </div>
                         <button onClick={addDispItem} className="text-xs font-bold bg-white text-blue-600 px-3 py-1.5 rounded-md border border-blue-200 hover:bg-blue-50 transition-colors flex items-center gap-1"><Plus className="w-3.5 h-3.5"/> เพิ่มข้อมูลจ่ายยา</button>
                      </div>
                    )}
                 </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-100 bg-white flex justify-end gap-3 rounded-b-2xl shrink-0">
                <button onClick={() => setIsEditMode(false)} className="px-5 py-2.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg text-sm font-bold transition-colors">ยกเลิก</button>
                <button onClick={handleSaveChanges} className="px-8 py-2.5 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 shadow-sm transition-all active:scale-95 flex items-center gap-2">
                   <Save className="w-4 h-4" /> บันทึกและตรวจสอบซ้ำ
                </button>
            </div>
          </div>
        </div>
      )}

      {/* --- SQL MODAL --- */}
      {isSqlModalOpen && currentSql && (
         <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
             <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full p-8 border border-slate-200">
                <h3 className="text-xl font-extrabold text-slate-800 mb-6 flex items-center gap-2 tracking-tight border-b border-slate-100 pb-4">
                  <Database className="w-6 h-6 text-blue-500" />
                  {currentSql.id !== '' && sqlScripts.find(s=>s.id === currentSql.id) ? 'แก้ไขคำสั่ง SQL' : 'เพิ่มคำสั่ง SQL ใหม่'}
                </h3>
                <form onSubmit={handleSaveSql} className="space-y-5">
                  <div>
                    <label className="block text-[13px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">ชื่อคำสั่ง (Title)</label>
                    <input type="text" placeholder="e.g. รายงานดึงข้อมูล OPD" value={currentSql.title} onChange={e => setCurrentSql({...currentSql, title: e.target.value})} className="w-full border border-slate-300 px-4 py-2.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-all" required />
                  </div>
                  <div>
                    <label className="block text-[13px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">คำอธิบาย (Description)</label>
                    <input type="text" placeholder="e.g. ดึง 16 หมวด กบก." value={currentSql.desc} onChange={e => setCurrentSql({...currentSql, desc: e.target.value})} className="w-full border border-slate-300 px-4 py-2.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-all" />
                  </div>
                  <div>
                    <label className="block text-[13px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">SQL Code</label>
                    <textarea placeholder="SELECT * FROM..." value={currentSql.code} onChange={e => setCurrentSql({...currentSql, code: e.target.value})} className="w-full border border-slate-200 px-4 py-4 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 bg-slate-50 text-blue-800 leading-relaxed" rows="10" required />
                  </div>
                  <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                    <button type="button" onClick={() => setIsSqlModalOpen(false)} className="px-5 py-2.5 text-slate-500 hover:bg-slate-100 rounded-lg transition-colors font-bold text-sm">ยกเลิก</button>
                    <button type="submit" className="px-8 py-2.5 bg-blue-600 text-white font-bold rounded-lg shadow-sm hover:bg-blue-700 transition-all active:scale-95 flex items-center gap-2 text-sm">
                      <Save className="w-4 h-4"/> บันทึก
                    </button>
                  </div>
                </form>
             </div>
         </div>
      )}

      {/* --- RULE CONFIGURATION MODAL --- */}
      {isRuleModalOpen && (
         <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
             <div className="bg-white rounded-2xl shadow-2xl max-w-xl w-full p-8 border border-slate-200">
                <h3 className="text-xl font-extrabold text-slate-800 mb-6 flex items-center gap-2 tracking-tight border-b border-slate-100 pb-4">
                  <Settings className="w-6 h-6 text-slate-400" />
                  {isEditingRule ? 'แก้ไขกฎการตรวจสอบ' : 'เพิ่มกฎการตรวจสอบใหม่'}
                </h3>
                <form onSubmit={handleSaveRule} className="space-y-5">
                  <div className="grid grid-cols-2 gap-5">
                    <div>
                      <label className="block text-[13px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">หมวดหมู่กฎ</label>
                      <select value={currentRule?.category || 'C_ERROR'} onChange={e => setCurrentRule({...currentRule, category: e.target.value})} className="w-full border border-slate-300 px-4 py-2.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 bg-white transition-all">
                        <option value="C_ERROR">กฎตรวจสอบติด C</option>
                        <option value="LOCAL_RULE">เงื่อนไขศูนย์การแพทย์</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[13px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">Rule ID</label>
                      <input type="text" placeholder="e.g. C05" value={currentRule?.id} onChange={e => setCurrentRule({...currentRule, id: e.target.value})} className="w-full border border-slate-300 px-4 py-2.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 bg-white transition-all" disabled={isEditingRule} required />
                    </div>
                  </div>
                  <div className="grid grid-cols-1">
                    <div>
                      <label className="block text-[13px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">ชื่อกฎ (Label)</label>
                      <input type="text" value={currentRule?.label} onChange={e => setCurrentRule({...currentRule, label: e.target.value})} className="w-full border border-slate-300 px-4 py-2.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 bg-white transition-all" required />
                    </div>
                  </div>
                  <div>
                      <label className="block text-[13px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">ระดับความรุนแรง (Severity)</label>
                      <select value={currentRule?.severity} onChange={e => setCurrentRule({...currentRule, severity: e.target.value})} className="w-full border border-slate-300 px-4 py-2.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 bg-white transition-all">
                        <option value="Critical">Critical (ห้ามเบิก - Status FAIL)</option>
                        <option value="Warning">Warning (แจ้งเตือน - Status PASS)</option>
                      </select>
                  </div>
                  <div>
                    <label className="block text-[13px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">คำอธิบาย (Description)</label>
                    <textarea value={currentRule?.desc} onChange={e => setCurrentRule({...currentRule, desc: e.target.value})} className="w-full border border-slate-300 px-4 py-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-all" rows="3" />
                  </div>
                  <div className="flex items-center gap-3 pt-2 bg-slate-50 p-4 rounded-xl border border-slate-100">
                    <input type="checkbox" id="ruleActive" checked={currentRule?.active} onChange={e => setCurrentRule({...currentRule, active: e.target.checked})} className="w-5 h-5 text-blue-600 rounded border-slate-300 focus:ring-blue-500 cursor-pointer" />
                    <label htmlFor="ruleActive" className="text-sm font-bold text-slate-700 cursor-pointer">เปิดใช้งานกฎนี้ทันที</label>
                  </div>
                  <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                    <button type="button" onClick={() => setIsRuleModalOpen(false)} className="px-5 py-2.5 text-slate-500 hover:bg-slate-100 rounded-lg transition-colors font-bold text-sm">ยกเลิก</button>
                    <button type="submit" className="px-8 py-2.5 bg-blue-600 text-white font-bold rounded-lg shadow-sm hover:bg-blue-700 transition-all active:scale-95 flex items-center gap-2 text-sm">
                      <Save className="w-4 h-4"/> บันทึก
                    </button>
                  </div>
                </form>
             </div>
         </div>
      )}

      {/* --- BULK EDIT MODAL --- */}
      {isBulkModalOpen && (
         <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
             <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-8 border border-slate-200">
                <h3 className="text-xl font-extrabold text-slate-800 mb-2 flex items-center gap-2 tracking-tight">
                  <Layers className="w-6 h-6 text-blue-500" /> แก้ไขหลายรายการพร้อมกัน
                </h3>
                <p className="text-sm text-slate-500 mb-6 border-b border-slate-100 pb-4">
                   จะแก้ไขค่าฟิลด์ที่เลือก ให้กับ <span className="font-bold text-blue-600">{filteredData.length} รายการ</span> ที่แสดงอยู่ในตาราง (ตาม filter ปัจจุบัน)
                </p>
                <div className="space-y-5">
                   <div>
                      <label className="block text-[13px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">ฟิลด์ที่ต้องการแก้ไข</label>
                      <select value={bulkField} onChange={e => setBulkField(e.target.value)} className="w-full border border-slate-300 px-4 py-2.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 bg-white transition-all">
                         <option value="">-- เลือกฟิลด์ --</option>
                         <optgroup label="OPServices">
                            <option value="Class">Class</option>
                            <option value="HCode">HCode</option>
                            <option value="CareAccount">CareAccount</option>
                            <option value="TypeServ">TypeServ</option>
                            <option value="TypeIn">TypeIn</option>
                            <option value="TypeOut">TypeOut</option>
                            <option value="SvPID">SvPID (แพทย์)</option>
                            <option value="Clinic">Clinic</option>
                            <option value="CodeSet">CodeSet</option>
                            <option value="STDCode">STDCode</option>
                            <option value="ClaimCat">ClaimCat</option>
                         </optgroup>
                         <optgroup label="BILLTRAN">
                            <option value="HMain">HMain</option>
                            <option value="PayPlan">PayPlan</option>
                            <option value="Tflag">Tflag</option>
                            <option value="VerCode">VerCode</option>
                         </optgroup>
                      </select>
                   </div>
                   <div>
                      <label className="block text-[13px] font-bold text-slate-500 mb-1.5 uppercase tracking-wider">ค่าใหม่</label>
                      <input type="text" value={bulkValue} onChange={e => setBulkValue(e.target.value)} placeholder="พิมพ์ค่าที่ต้องการตั้ง..." className="w-full border border-slate-300 px-4 py-2.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400 transition-all" />
                   </div>
                   <div className="bg-amber-50 border border-amber-100 rounded-lg p-3 text-xs text-amber-700 flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                      <span>การแก้ไขนี้จะเขียนทับค่าเดิมทุกรายการที่แสดงอยู่ และตรวจสอบเงื่อนไข (Audit) ใหม่ทันที</span>
                   </div>
                </div>
                <div className="flex justify-end gap-3 pt-6 mt-2 border-t border-slate-100">
                   <button onClick={() => setIsBulkModalOpen(false)} className="px-5 py-2.5 text-slate-500 hover:bg-slate-100 rounded-lg transition-colors font-bold text-sm">ยกเลิก</button>
                   <button onClick={applyBulkEdit} className="px-8 py-2.5 bg-blue-600 text-white font-bold rounded-lg shadow-sm hover:bg-blue-700 transition-all active:scale-95 flex items-center gap-2 text-sm">
                      <Save className="w-4 h-4"/> ใช้กับ {filteredData.length} รายการ
                   </button>
                </div>
             </div>
         </div>
      )}

      {/* --- HELP MODAL --- */}
      {showHelp && (
        <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full p-8 border border-slate-200">
            <div className="flex justify-between items-center mb-6 border-b border-slate-100 pb-4">
              <h3 className="text-2xl font-extrabold text-slate-800 flex items-center gap-3 tracking-tight">
                <HelpCircle className="w-7 h-7 text-blue-500" /> คู่มือการใช้งาน
              </h3>
              <button onClick={() => setShowHelp(false)} className="p-2 text-slate-400 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"><X className="w-6 h-6" /></button>
            </div>
            <div className="space-y-6 px-2">
              <HelpStep n="1" title="เตรียมข้อมูลจาก HOSxP" desc="ส่งออกข้อมูล สกส. แบบปกติ (จะได้ไฟล์ BILLTRAN.txt, OPServices.txt, BILLDISP.txt)" />
              <HelpStep n="2" title="นำเข้าข้อมูล (Import)" desc='กดปุ่มมุมขวาบน "นำเข้าข้อมูล" แล้วลากคลุมเลือกไฟล์ทั้งหมดพร้อมกัน ระบบจะคัดกรองข้อมูลอัตโนมัติ' />
              <HelpStep n="3" title="ตรวจสอบและแก้ไข (Audit & Fix)" desc="รายการที่ผิดเงื่อนไขจะขึ้นเป็นสีแดง (FAIL) ให้คลิกที่รายการเพื่อเปิดหน้า CHI Editor กรอกข้อมูลที่ขาดหายแล้วกดบันทึก" />
              <HelpStep n="4" title="ส่งออกไฟล์เพื่อเบิกจ่าย (Export)" desc='ไปที่เมนู "ส่งออกข้อมูล" ด้านซ้ายมือ กดดาวน์โหลดไฟล์ TXT (windows-874) ที่ผ่านการแก้ไขแล้วไปส่งเบิกในโปรแกรม สกส. ต่อได้เลย' />
            </div>
            <div className="mt-8 pt-5 border-t border-slate-100 flex justify-end">
              <button onClick={() => setShowHelp(false)} className="px-8 py-2.5 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 shadow-sm transition-all active:scale-95">เข้าใจแล้ว</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const RuleRow = ({ rule, onToggle, onEdit, onDelete }) => (
  <div className={`group flex flex-col md:flex-row items-start gap-4 p-4 border rounded-xl transition-all ${rule.active ? 'border-slate-200 bg-white hover:border-blue-200 hover:shadow-sm' : 'border-slate-100 bg-slate-50 opacity-60'}`}>
    <div className="pt-1">
       <input type="checkbox" checked={rule.active} onChange={() => onToggle(rule.id)} className="w-5 h-5 text-blue-600 rounded border-slate-300 focus:ring-blue-500 cursor-pointer" />
    </div>
    <div className="flex-1 w-full">
      <div className="flex flex-wrap items-center gap-2 mb-1.5">
        <span className={`text-xs font-black tracking-wide px-2.5 py-0.5 rounded-md ${rule.severity === 'Critical' ? 'text-rose-700 bg-rose-100' : 'text-amber-700 bg-amber-100'}`}>{rule.id}</span>
        <span className="font-bold text-slate-700 text-sm">{rule.label}</span>
      </div>
      <p className="text-sm text-slate-500 leading-relaxed">{rule.desc}</p>
    </div>
    <div className="flex gap-2 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity">
       <button onClick={onEdit} className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"><Edit2 className="w-4 h-4" /></button>
       <button onClick={onDelete} className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"><Trash2 className="w-4 h-4" /></button>
    </div>
  </div>
);

const HelpStep = ({ n, title, desc }) => (
  <div className="flex items-start gap-5">
    <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-extrabold flex-shrink-0 text-lg">{n}</div>
    <div className="pt-1">
      <h4 className="font-bold text-slate-800 text-base mb-1">{title}</h4>
      <p className="text-sm text-slate-500 leading-relaxed">{desc}</p>
    </div>
  </div>
);

const SidebarItem = ({ icon, label, active, onClick }) => (
  <button onClick={onClick} className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-xl transition-all duration-200 outline-none ${active ? 'bg-blue-50 text-blue-700 font-bold border-l-4 border-blue-600' : 'text-slate-500 hover:bg-slate-50 hover:text-blue-600 font-medium border-l-4 border-transparent'}`}>
    {React.cloneElement(icon, { size: 20, className: active ? 'text-blue-600' : 'text-slate-400' })} <span className="text-sm tracking-wide">{label}</span>
  </button>
);

const StatCard = ({ title, value, sub, icon, bg, textColor = 'text-slate-800' }) => (
  <div className="bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex items-start justify-between hover:shadow-md transition-shadow">
    <div>
      <p className="text-[13px] font-extrabold text-slate-400 uppercase tracking-widest mb-1.5">{title}</p>
      <h3 className={`text-3xl font-black tracking-tight ${textColor}`}>{value}</h3>
      <p className="text-xs text-slate-400 mt-1.5 font-medium">{sub}</p>
    </div>
    <div className={`p-3.5 rounded-xl ${bg}`}>{icon}</div>
  </div>
);

const Input = ({ label, field, data, onChange, type="text", span="", readOnly=false, bg="bg-white", font="" }) => (
  <div className={span}>
    <label className="text-[12px] font-bold text-slate-400 uppercase tracking-wider mb-1 block">{label}</label>
    <input type={type} value={data[field] ?? ''} onChange={(e) => onChange(field, e.target.value)} className={`w-full text-xs border border-slate-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-100 focus:border-blue-400 outline-none transition-all shadow-sm ${bg} ${font}`} readOnly={readOnly} />
  </div>
);

const ExportBtn = ({ icon, color, title, onClick }) => {
  const colorMap = {
    emerald: 'border-emerald-100 hover:border-emerald-300 hover:shadow-emerald-50',
    navy: 'border-slate-200 hover:border-blue-300 hover:shadow-blue-50'
  };
  const iconBgMap = {
    emerald: 'bg-emerald-50 text-emerald-600',
    navy: 'bg-blue-50 text-blue-600'
  };
  const btnMap = {
    emerald: 'bg-emerald-500 hover:bg-emerald-600 text-white',
    navy: 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:text-blue-600'
  };

  return (
    <div className={`border-2 rounded-2xl p-6 text-center shadow-sm transition-all cursor-pointer bg-white ${colorMap[color]}`} onClick={onClick}>
      <div className={`w-14 h-14 mx-auto mb-4 flex items-center justify-center rounded-2xl ${iconBgMap[color]}`}>
        {React.cloneElement(icon, { size: 28 })}
      </div>
      <h4 className="font-extrabold text-slate-700 text-base mb-4 tracking-tight">{title}</h4>
      <button className={`w-full py-2.5 text-xs font-bold rounded-lg shadow-sm flex items-center justify-center gap-1.5 transition-colors ${btnMap[color]}`}>
         <Download className="w-4 h-4" /> ดาวน์โหลด
      </button>
    </div>
  );
};

export default App;
