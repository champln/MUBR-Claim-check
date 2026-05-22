import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle,
  Download,
  Edit2,
  FileText,
  Menu,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react';

const NAVY = '#00246B';
const GOLD = '#F2A900';

const SCHEMA = {
  BILLTRAN: ['InvNo', 'HN', 'PID', 'Sex', 'Dx', 'DateOPD', 'Clinic', 'Total'],
  OPSERVICES: ['InvNo', 'Code', 'Qty', 'Charge'],
  BILLDISP: ['InvNo', 'DrugCode', 'Qty', 'Charge'],
  BILLITEMS: ['InvNo', 'ItemCode', 'Qty', 'Charge'],
};

const FILE_KEYS = Object.keys(SCHEMA);
const TOAST_DURATION_MS = 2400;
const THAI_LOCALE = 'th';

const decodeText = async (file) => {
  const buffer = await file.arrayBuffer();
  const decoder = new TextDecoder('windows-874', { fatal: false });
  return decoder.decode(buffer);
};

const parseCSMBS = (text, fileKey) => {
  const fields = SCHEMA[fileKey] || [];
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, index) => {
      const raw = line.split('|');
      const row = { __id: `${fileKey}-${index}` };
      fields.forEach((field, i) => {
        row[field] = raw[i] ?? '';
      });
      return row;
    });
};


const WIN874_EXTRA_MAP = {
  0x20AC: 0x80,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201C: 0x93,
  0x201D: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
};

const encodeWindows874 = (text) => {
  const bytes = [];
  for (const char of text) {
    const code = char.codePointAt(0);
    if (code <= 0x7f) {
      bytes.push(code);
    } else if (code >= 0x0e01 && code <= 0x0e3a) {
      bytes.push(code - 0x0e01 + 0xa1);
    } else if (code >= 0x0e3f && code <= 0x0e5b) {
      bytes.push(code - 0x0e3f + 0xdf);
    } else if (WIN874_EXTRA_MAP[code]) {
      bytes.push(WIN874_EXTRA_MAP[code]);
    } else {
      bytes.push(0x3f);
    }
  }
  return new Uint8Array(bytes);
};

const toPipeText = (rows, fileKey) => {
  const fields = SCHEMA[fileKey] || [];
  return rows.map((row) => fields.map((f) => row[f] ?? '').join('|')).join('\r\n');
};

const toCsvText = (rows, fileKey) => {
  const fields = SCHEMA[fileKey] || [];
  const header = fields.join(',');
  const body = rows.map((row) => fields.map((f) => `"${String(row[f] ?? '').replaceAll('"', '""')}"`).join(','));
  return [header, ...body].join('\n');
};

const saveFile = (content, fileName) => {
  const blob = new Blob([encodeWindows874(content)], { type: 'text/plain;charset=windows-874' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(a.href);
};

const validateRows = (rows) => {
  const errors = [];
  rows.forEach((row) => {
    if ('DrugCode' in row && !row.DrugCode) {
      errors.push(`InvNo ${row.InvNo || '-'}: ไม่พบรหัสยา`);
    }
    const sex = String(row.Sex || '').toUpperCase();
    const dx = String(row.Dx || '').toUpperCase();
    if (sex === 'M' && /^O\d{2}(\.|$)/i.test(dx)) {
      errors.push(`InvNo ${row.InvNo || '-'}: โรคไม่สอดคล้องกับเพศ`);
    }
  });
  return errors;
};

export default function App() {
  const [activeFile, setActiveFile] = useState('BILLTRAN');
  const [data, setData] = useState({ BILLTRAN: [], OPSERVICES: [], BILLDISP: [], BILLITEMS: [] });
  const [editFormData, setEditFormData] = useState(null);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState('InvNo');
  const [sortAsc, setSortAsc] = useState(true);
  const [page, setPage] = useState(1);
  const [filterText, setFilterText] = useState('');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const pageSize = 10;
  const rows = data[activeFile] || [];
  const fields = SCHEMA[activeFile] || [];
  const errors = useMemo(() => validateRows(rows), [rows]);

  const filteredRows = useMemo(() => {
    const s = search.trim().toLowerCase();
    const f = filterText.trim().toLowerCase();
    return rows
      .filter((row) => {
        const keyMatch = !s || ['InvNo', 'HN', 'PID'].some((k) => String(row[k] || '').toLowerCase().includes(s));
        const colMatch = !f || String(row[sortKey] || '').toLowerCase().includes(f);
        return keyMatch && colMatch;
      })
      .sort((a, b) => {
        const av = String(a[sortKey] || '');
        const bv = String(b[sortKey] || '');
        return sortAsc ? av.localeCompare(bv, THAI_LOCALE) : bv.localeCompare(av, THAI_LOCALE);
      });
  }, [rows, search, filterText, sortKey, sortAsc]);

  const maxPage = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const safePage = Math.min(page, maxPage);
  const pageRows = filteredRows.slice((safePage - 1) * pageSize, safePage * pageSize);

  const showToast = (message) => {
    setToast(message);
    setTimeout(() => setToast(''), TOAST_DURATION_MS);
  };

  const handleUpload = async (event, fileKey) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      const text = await decodeText(file);
      const parsed = parseCSMBS(text, fileKey);
      setData((prev) => ({ ...prev, [fileKey]: parsed }));
      setPage(1);
      showToast(`นำเข้า ${fileKey} สำเร็จ ${parsed.length} รายการ`);
    } catch (error) {
      console.error('parseCSMBS error:', error);
      showToast(`ไม่สามารถอ่านไฟล์ ${fileKey}`);
    } finally {
      setLoading(false);
      event.target.value = '';
    }
  };

  const startEdit = (row) => setEditFormData({ ...row });

  const saveEdit = () => {
    if (!editFormData) return;
    setData((prev) => ({
      ...prev,
      [activeFile]: (prev[activeFile] || []).map((row) => (row.__id === editFormData.__id ? { ...editFormData } : row)),
    }));
    setEditFormData(null);
    showToast('บันทึกข้อมูลแล้ว');
  };

  const exportTxt = () => saveFile(toPipeText(rows, activeFile), `${activeFile}.txt`);
  const exportCsv = () => saveFile(toCsvText(rows, activeFile), `${activeFile}.csv`);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="sticky top-0 z-30 border-b bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <button className="rounded-lg border p-2 hover:bg-slate-100" onClick={() => setSidebarOpen((v) => !v)}>
              <Menu size={18} />
            </button>
            <ShieldCheck size={22} style={{ color: NAVY }} />
            <h1 className="font-semibold" style={{ color: NAVY }}>MBR Audit Center</h1>
          </div>
          <div className="flex items-center gap-2 rounded-lg border bg-white px-3 py-2 shadow-sm">
            <Search size={16} className="text-slate-400" />
            <input
              className="w-56 bg-transparent text-sm outline-none"
              placeholder="ค้นหา InvNo / HN / PID"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-7xl gap-4 px-4 py-4">
        {sidebarOpen && (
          <aside className="w-64 rounded-lg border bg-white p-3 shadow-sm">
            <p className="mb-2 text-xs font-medium text-slate-500">แฟ้มข้อมูล สกส.</p>
            <div className="space-y-2">
              {FILE_KEYS.map((key) => (
                <button
                  key={key}
                  className="w-full rounded-lg border px-3 py-2 text-left text-sm hover:bg-slate-100"
                  style={{ borderColor: key === activeFile ? GOLD : undefined }}
                  onClick={() => {
                    setActiveFile(key);
                    setSortKey(SCHEMA[key][0]);
                    setPage(1);
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span>{key}</span>
                    <span className="text-xs text-slate-500">{data[key].length}</span>
                  </div>
                </button>
              ))}
            </div>
            <label className="mt-3 block cursor-pointer rounded-lg px-3 py-2 text-center text-sm text-white shadow-sm hover:opacity-90" style={{ backgroundColor: NAVY }}>
              อัปโหลด {activeFile}
              <input className="hidden" type="file" accept=".txt,.csv" onChange={(e) => handleUpload(e, activeFile)} />
            </label>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button className="rounded-lg border px-3 py-2 text-xs hover:bg-slate-100" onClick={exportTxt}><Download size={14} className="inline" /> .txt</button>
              <button className="rounded-lg border px-3 py-2 text-xs hover:bg-slate-100" onClick={exportCsv}><Download size={14} className="inline" /> .csv</button>
            </div>
          </aside>
        )}

        <section className="min-w-0 flex-1 rounded-lg border bg-white p-3 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm">
              <FileText size={16} style={{ color: NAVY }} />
              <span className="font-medium" style={{ color: NAVY }}>{activeFile}</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{filteredRows.length} รายการ</span>
            </div>
            <input
              className="rounded-lg border px-3 py-1.5 text-sm outline-none focus:ring"
              placeholder={`กรองตาม ${sortKey}`}
              value={filterText}
              onChange={(e) => {
                setFilterText(e.target.value);
                setPage(1);
              }}
            />
          </div>

          <div className="max-h-[60vh] overflow-auto rounded-lg border">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 z-10 bg-slate-100">
                <tr>
                  {fields.map((field) => (
                    <th
                      key={field}
                      className="cursor-pointer px-3 py-2 text-left font-medium"
                      onClick={() => {
                        if (sortKey === field) setSortAsc((v) => !v);
                        else {
                          setSortKey(field);
                          setSortAsc(true);
                        }
                      }}
                    >
                      {field} {sortKey === field ? (sortAsc ? '▲' : '▼') : ''}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => (
                  <tr key={row.__id} className="border-t hover:bg-slate-50">
                    {fields.map((field) => <td key={field} className="px-3 py-2">{row[field]}</td>)}
                    <td className="px-3 py-2 text-right">
                      <button className="rounded-lg border px-2 py-1 hover:bg-slate-100" onClick={() => startEdit(row)}>
                        <Edit2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
                {!pageRows.length && (
                  <tr><td colSpan={fields.length + 1} className="px-3 py-6 text-center text-slate-500">ยังไม่มีข้อมูล</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex items-center justify-between text-sm">
            <div className="flex items-center gap-1">
              <button className="rounded-lg border px-2 py-1 hover:bg-slate-100" onClick={() => setPage(Math.max(1, safePage - 1))}>ก่อนหน้า</button>
              <span>หน้า {safePage} / {maxPage}</span>
              <button className="rounded-lg border px-2 py-1 hover:bg-slate-100" onClick={() => setPage(Math.min(maxPage, safePage + 1))}>ถัดไป</button>
            </div>
            <div className="flex items-center gap-2">
              {!!errors.length ? (
                <span className="flex items-center gap-1 text-amber-700"><AlertTriangle size={14} /> พบ {errors.length} จุดผิดปกติ</span>
              ) : (
                <span className="flex items-center gap-1 text-emerald-700"><CheckCircle size={14} /> ตรวจสอบเบื้องต้นผ่าน</span>
              )}
            </div>
          </div>

          {!!errors.length && (
            <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              {errors.slice(0, 5).map((e, idx) => <div key={`err-${idx}`}>• {e}</div>)}
              {errors.length > 5 && <div className="mt-1 text-[11px] text-amber-700">แสดง 5 รายการจากทั้งหมด {errors.length} รายการ</div>}
            </div>
          )}
        </section>
      </main>

      {editFormData && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-2xl rounded-lg bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold" style={{ color: NAVY }}>แก้ไขข้อมูล {activeFile}</h2>
              <button className="rounded-lg border p-1 hover:bg-slate-100" onClick={() => setEditFormData(null)}><X size={16} /></button>
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {fields.map((field) => (
                <label key={field} className="text-xs text-slate-600">
                  {field}
                  <input
                    className="mt-1 w-full rounded-lg border px-2 py-1.5 text-sm"
                    value={editFormData[field] ?? ''}
                    onChange={(e) => setEditFormData((prev) => ({ ...prev, [field]: e.target.value }))}
                  />
                </label>
              ))}
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button className="rounded-lg border px-3 py-1.5 text-sm hover:bg-slate-100" onClick={() => setEditFormData(null)}>ยกเลิก</button>
              <button className="rounded-lg px-3 py-1.5 text-sm text-white hover:opacity-90" style={{ backgroundColor: NAVY }} onClick={saveEdit}>บันทึก</button>
            </div>
          </div>
        </div>
      )}

      {loading && (
        <div className="fixed bottom-4 right-4 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white shadow-sm">กำลังประมวลผลไฟล์...</div>
      )}
      {!!toast && (
        <div className="fixed bottom-16 right-4 rounded-lg px-4 py-2 text-sm text-white shadow-sm" style={{ backgroundColor: NAVY }}>
          {toast}
        </div>
      )}
    </div>
  );
}
