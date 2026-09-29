import { useCallback, useMemo, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  FileCheck2, Upload, FileText, X, Search, Download, AlertTriangle, AlertCircle,
  CheckCircle2, Calculator, Info,
} from 'lucide-react'
import clsx from 'clsx'
import {
  validateCipn, applyCipnFix,
  type CipnValidateResult, type CipnChange,
} from '../lib/api'

const CAT_LABEL: Record<string, string> = {
  T: 'T — เบิกแยกนอก DRG',
  D: 'D — รวมอยู่ใน DRG',
  X: 'X — ไม่ขอเบิก (บริจาค/ทุนวิจัย)',
}

export default function CipnFixPage() {
  const [files, setFiles] = useState<File[]>([])
  const [result, setResult] = useState<CipnValidateResult | null>(null)
  const [picked, setPicked] = useState<Record<string, { cat: string; up: string }>>({})
  const [search, setSearch] = useState('')
  const [onlyFlagged, setOnlyFlagged] = useState(true)

  const onDrop = useCallback((accepted: File[]) => {
    setFiles(accepted.slice(0, 1))
    setResult(null)
    setPicked({})
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/xml': ['.xml'], 'application/xml': ['.xml'],
      'application/zip': ['.zip'], 'application/x-zip-compressed': ['.zip'],
    },
    maxFiles: 1,
  })

  const changes: CipnChange[] = useMemo(() =>
    Object.entries(picked)
      .filter(([, v]) => v.cat)
      .map(([seq, v]) => ({ seq, claim_cat: v.cat, ...(v.cat === 'T' ? { claim_up: v.up } : {}) })),
    [picked])

  const validateMutation = useMutation({
    mutationFn: () => validateCipn(files),
    onSuccess: (res) => {
      setResult(res)
      setPicked({})
      if (res.error_count === 0 && res.warning_count === 0) toast.success('ตรวจแล้วไม่พบปัญหา')
      else toast(`พบข้อผิดพลาด ${res.error_count} · คำเตือน ${res.warning_count}`, { icon: '⚠️' })
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'ตรวจสอบไม่สำเร็จ'),
  })

  const applyMutation = useMutation({
    mutationFn: () => applyCipnFix(files, changes),
    onSuccess: (res) => {
      toast.success(
        `แก้ ${res.applied.length} แถว · DRGCharge ${res.totals.drg_charge_calc} · XDRGClaim ${res.totals.xdrg_claim_calc} — ${res.filename}`,
        { duration: 7000 })
      if (res.errorsAfter > 0) toast(`ยังเหลือข้อผิดพลาด ${res.errorsAfter} ข้อ`, { icon: '⚠️' })
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'แก้ไฟล์ไม่สำเร็จ'),
  })

  const q = search.trim().toLowerCase()
  const rows = (result?.rows || [])
    .filter(r => !onlyFlagged || r.suggest_cat || picked[r.seq])
    .filter(r => !q || r.lccode.toLowerCase().includes(q) || r.desc.toLowerCase().includes(q)
      || r.seq === q || r.billgrcs === q)

  const totalsMismatch = result && (
    result.totals.drg_charge_file !== result.totals.drg_charge_calc ||
    result.totals.xdrg_claim_file !== result.totals.xdrg_claim_calc)

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <FileCheck2 className="w-5 h-5 text-violet-600" /> ตรวจ/แก้ไฟล์ผู้ป่วยใน (ClaimCat &amp; ยอดรวม)
        </h2>
        <p className="text-sm text-gray-500 mt-0.5">
          ตรวจไฟล์ CIPN/AIPN ตามสเปก สกส. แก้ <code className="text-violet-700">ClaimCat</code> ให้ตรงเงื่อนไขการเบิก
          แล้วคำนวณ DRGCharge · XDRGClaim · HMAC ใหม่ให้ครบในครั้งเดียว
        </p>
        <div className="mt-3 text-xs text-gray-600 bg-violet-50 border border-violet-100 rounded-lg p-3 space-y-1">
          <div>
            <b>DRGCharge</b> = ผลรวม (ยอดรายการ − ส่วนลด) ของแถว <b>D</b> ·
            <b> XDRGClaim</b> = ผลรวมค่าที่น้อยกว่าระหว่างยอดขอเบิกกับยอดรายการ ของแถว <b>T</b>
          </div>
          <div className="text-gray-500">
            รหัสตีกลับที่เกี่ยวข้อง — <b>35</b> ผลรวม DRGCharge ผิด · <b>36</b> ผลรวม XDRGClaim ผิด ·
            <b> 30</b> รูปแบบไฟล์ผิด · <b>22</b> ค่า HMAC ไม่ตรง
          </div>
        </div>
      </div>

      {/* 1. ไฟล์ */}
      <div className="card p-5 space-y-3">
        <h3 className="font-semibold text-gray-800 text-sm">1. ไฟล์ผู้ป่วยใน (CIPN/AIPN .xml หรือ .zip)</h3>
        <div {...getRootProps()} className={clsx('border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors',
          isDragActive ? 'border-violet-400 bg-violet-50' : 'border-gray-300 hover:border-gray-400')}>
          <input {...getInputProps()} />
          <Upload className="w-8 h-8 mx-auto text-gray-400 mb-2" />
          <p className="text-sm text-gray-600">ลากวางไฟล์ หรือคลิกเพื่อเลือก (ครั้งละ 1 ไฟล์)</p>
        </div>
        {files.map(f => (
          <div key={f.name} className="flex items-center gap-2 text-sm bg-gray-50 rounded-lg px-3 py-2">
            <FileText className="w-4 h-4 text-violet-500" />
            <span className="flex-1 truncate">{f.name}</span>
            <span className="text-xs text-gray-400">{(f.size / 1024).toFixed(0)} KB</span>
            <button onClick={() => { setFiles([]); setResult(null); setPicked({}) }}
              className="text-gray-400 hover:text-rose-500"><X className="w-4 h-4" /></button>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => validateMutation.mutate()} disabled={!files.length || validateMutation.isPending}
          className="btn-secondary">
          <Search className="w-4 h-4" /> {validateMutation.isPending ? 'กำลังตรวจ...' : 'ตรวจไฟล์'}
        </button>
        <button onClick={() => applyMutation.mutate()}
          disabled={!files.length || applyMutation.isPending || (changes.length === 0 && !totalsMismatch && result?.signature_ok !== false)}
          className="btn-primary">
          <Download className="w-4 h-4" />
          {applyMutation.isPending ? 'กำลังแก้...'
            : changes.length ? `แก้ ${changes.length} แถว & ดาวน์โหลด`
            : 'คำนวณยอด+HMAC ใหม่ & ดาวน์โหลด'}
        </button>
        {result && (
          <span className="text-xs text-gray-500">
            ทุกครั้งที่ดาวน์โหลด ระบบคำนวณ DRGCharge · XDRGClaim · HMAC และตั้งชื่อไฟล์ใหม่ตามสเปกให้อัตโนมัติ
          </span>
        )}
      </div>

      {result && (
        <>
          {/* สรุป */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <SummaryBox label="ข้อผิดพลาด" value={result.error_count} tone={result.error_count ? 'rose' : 'gray'}
              icon={<AlertCircle className="w-4 h-4" />} />
            <SummaryBox label="คำเตือน" value={result.warning_count} tone={result.warning_count ? 'amber' : 'gray'}
              icon={<AlertTriangle className="w-4 h-4" />} />
            <SummaryBox label="ค่า HMAC" value={result.signature_ok ? 'ถูกต้อง' : 'ไม่ตรง'}
              tone={result.signature_ok ? 'emerald' : 'rose'} icon={<CheckCircle2 className="w-4 h-4" />} />
          </div>

          {/* ยอดรวม */}
          <div className="card p-4">
            <h3 className="font-semibold text-gray-800 text-sm flex items-center gap-2 mb-3">
              <Calculator className="w-4 h-4 text-violet-600" /> ยอดรวมท้ายไฟล์
            </h3>
            <table className="text-sm">
              <thead className="text-xs text-gray-500">
                <tr><th className="pr-8 text-left">ยอด</th><th className="pr-8 text-right">ในไฟล์</th><th className="text-right">คำนวณจากรายการ</th></tr>
              </thead>
              <tbody className="font-mono">
                {([['DRGCharge', 'drg_charge_file', 'drg_charge_calc'],
                   ['XDRGClaim', 'xdrg_claim_file', 'xdrg_claim_calc']] as const).map(([label, fk, ck]) => {
                  const same = result.totals[fk] === result.totals[ck]
                  return (
                    <tr key={label}>
                      <td className="pr-8 py-1 font-sans text-gray-700">{label}</td>
                      <td className={clsx('pr-8 py-1 text-right', same ? 'text-gray-600' : 'text-rose-600')}>{result.totals[fk] || '-'}</td>
                      <td className={clsx('py-1 text-right', same ? 'text-gray-600' : 'text-emerald-700 font-semibold')}>{result.totals[ck]}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {totalsMismatch && (
              <p className="text-xs text-rose-600 mt-2">
                ยอดในไฟล์ไม่ตรงกับผลรวมรายการ — กดดาวน์โหลดเพื่อให้ระบบเขียนค่าที่คำนวณได้ลงไป
              </p>
            )}
          </div>

          {/* รายการปัญหา */}
          {result.findings.length > 0 && (
            <div className="card overflow-hidden">
              <div className="px-4 py-2.5 border-b bg-gray-50 font-semibold text-gray-800 text-sm">
                สิ่งที่ตรวจพบ ({result.findings.length})
              </div>
              <ul className="divide-y divide-gray-100 max-h-72 overflow-y-auto">
                {result.findings.map((f, i) => (
                  <li key={i} className="px-4 py-2.5 flex items-start gap-3 text-sm">
                    <span className={clsx('font-mono text-[13px] font-bold rounded px-1.5 py-0.5 shrink-0',
                      f.severity === 'ERROR' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700')}>
                      {f.code}
                    </span>
                    <span className="flex-1">
                      <span className="text-gray-800">{f.message}</span>
                      {f.where && <span className="text-gray-400 text-xs"> · {f.where}</span>}
                      {f.suggest && <span className="text-violet-600 text-xs"> · แนะนำ: {f.suggest}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ตารางรายการ */}
          <div className="card overflow-hidden">
            <div className="px-4 py-2.5 border-b bg-gray-50 flex flex-wrap items-center gap-3">
              <h3 className="font-semibold text-gray-800 text-sm">รายการค่ารักษา</h3>
              <label className="text-xs text-gray-600 flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={onlyFlagged} onChange={e => setOnlyFlagged(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-gray-300 text-violet-600" />
                แสดงเฉพาะแถวที่ระบบสงสัย
              </label>
              <div className="relative ml-auto">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="ค้นหารหัส / ชื่อรายการ / หมวด"
                  className="border border-gray-300 rounded-lg pl-8 pr-3 py-1.5 text-sm w-64 focus:ring-2 focus:ring-violet-300 outline-none" />
              </div>
            </div>
            <div className="overflow-x-auto max-h-[30rem] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-white sticky top-0 border-b text-xs text-gray-500 uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left">ลำดับ</th>
                    <th className="px-3 py-2 text-left">หมวด</th>
                    <th className="px-3 py-2 text-left">รหัส</th>
                    <th className="px-3 py-2 text-left">ชื่อรายการ</th>
                    <th className="px-3 py-2 text-right">ยอด</th>
                    <th className="px-3 py-2 text-right">ราคาเบิก/หน่วย</th>
                    <th className="px-3 py-2 text-right">ยอดขอเบิก</th>
                    <th className="px-3 py-2 text-left">ปัจจุบัน</th>
                    <th className="px-3 py-2 text-left">เปลี่ยนเป็น</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map(r => {
                    const pick = picked[r.seq]
                    return (
                      <tr key={r.seq} className={clsx(r.suggest_cat && 'bg-amber-50/40', pick?.cat && 'bg-violet-50/50')}>
                        <td className="px-3 py-2 font-mono text-gray-500">{r.seq}</td>
                        <td className="px-3 py-2 font-mono">{r.billgrcs}</td>
                        <td className="px-3 py-2 font-mono text-gray-600">{r.lccode}</td>
                        <td className="px-3 py-2 truncate max-w-xs" title={r.desc}>{r.desc}</td>
                        <td className="px-3 py-2 text-right font-mono">{r.charge_amt}</td>
                        <td className="px-3 py-2 text-right font-mono text-gray-500">{r.claim_up}</td>
                        <td className="px-3 py-2 text-right font-mono text-gray-500">{r.claim_amt}</td>
                        <td className="px-3 py-2">
                          <span className={clsx('font-mono text-xs font-bold rounded px-1.5 py-0.5',
                            r.claim_cat === 'T' ? 'bg-blue-100 text-blue-700'
                              : r.claim_cat === 'D' ? 'bg-gray-100 text-gray-700' : 'bg-purple-100 text-purple-700')}>
                            {r.claim_cat}
                          </span>
                          {r.suggest_cat && (
                            <span className="text-[13px] text-amber-700 ml-1.5">ควรเป็น {r.suggest_cat}</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1.5">
                            <select value={pick?.cat || ''}
                              onChange={e => setPicked(p => ({ ...p, [r.seq]: { cat: e.target.value, up: p[r.seq]?.up || '' } }))}
                              className="border border-gray-300 rounded px-2 py-1 text-sm bg-white">
                              <option value="">— ไม่เปลี่ยน —</option>
                              {Object.entries(CAT_LABEL).map(([k, label]) => (
                                <option key={k} value={k}>{label}</option>
                              ))}
                            </select>
                            {pick?.cat === 'T' && (
                              <input value={pick.up} onChange={e => setPicked(p => ({ ...p, [r.seq]: { cat: 'T', up: e.target.value } }))}
                                placeholder="ราคาเบิก/หน่วย"
                                className="border border-violet-300 rounded px-2 py-1 text-sm font-mono w-32 focus:ring-1 focus:ring-violet-400 outline-none" />
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                  {rows.length === 0 && (
                    <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">
                      {onlyFlagged ? 'ไม่มีแถวที่ระบบสงสัย — เอาเครื่องหมายถูกออกเพื่อดูทุกแถว' : 'ไม่พบรายการ'}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-2 border-t text-[13px] text-gray-500 flex items-start gap-1.5">
              <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              เปลี่ยนเป็น T ต้องกรอกราคาเบิกต่อหน่วยตามบัญชีอัตราของกรมบัญชีกลาง — ระบบจะไม่คิดราคาให้เองจากยอดที่เรียกเก็บ
              เพราะจะกลายเป็นการเบิกเงินที่โรงพยาบาลไม่มีสิทธิ์
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function SummaryBox({ label, value, tone, icon }: {
  label: string; value: number | string; tone: 'rose' | 'amber' | 'emerald' | 'gray'; icon: React.ReactNode
}) {
  const tones = {
    rose: 'bg-rose-50 border-rose-200 text-rose-700',
    amber: 'bg-amber-50 border-amber-200 text-amber-700',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    gray: 'bg-gray-50 border-gray-200 text-gray-500',
  }
  return (
    <div className={clsx('rounded-xl border p-4 flex items-center gap-3', tones[tone])}>
      {icon}
      <div>
        <div className="text-xl font-bold">{value}</div>
        <div className="text-xs opacity-80">{label}</div>
      </div>
    </div>
  )
}
