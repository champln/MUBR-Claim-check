import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Tags, Download, RefreshCw, AlertTriangle, Info } from 'lucide-react'
import clsx from 'clsx'
import { getClaimCatMaster, type ClaimCatMasterItem } from '../lib/api'

const KIND_STYLE: Record<ClaimCatMasterItem['kind'], string> = {
  T_OUTSIDE: 'bg-rose-100 text-rose-700',
  D_ROOM: 'bg-amber-100 text-amber-700',
  EMPTY: 'bg-gray-100 text-gray-600',
}
const KIND_SHORT: Record<ClaimCatMasterItem['kind'], string> = {
  T_OUTSIDE: 'T นอกหมวด 01/02 → ควรเป็น D',
  D_ROOM: 'D ในหมวด 01/02 → ควรเป็น T',
  EMPTY: 'ยังไม่ได้ตั้ง',
}

// ดาวน์โหลด CSV (มี BOM ให้ Excel อ่านภาษาไทยได้)
function downloadCsv(rows: ClaimCatMasterItem[], since: string) {
  const head = ['รหัสรายการ', 'ชื่อรายการ', 'หมวด', 'ชื่อหมวด', 'ClaimCat ปัจจุบัน', 'ควรเป็น', 'ปัญหา',
    'ราคา', 'ใช้กับผู้ป่วยใน (admit)', 'ใช้ล่าสุด']
  const want = (r: ClaimCatMasterItem) => r.kind === 'T_OUTSIDE' ? 'D' : r.kind === 'D_ROOM' ? 'T' : (['01', '02'].includes(r.income) ? 'T' : 'D')
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lines = [head, ...rows.map(r => [r.icode, r.name, r.income, r.income_name, r.claim_cat || '(ว่าง)', want(r),
    r.kind_label, r.price, r.ipd_admissions, r.last_used || ''])].map(l => l.map(esc).join(','))
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `claimcat-hosxp-since-${since}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

// รายงานทะเบียนรายการ HOSxP ที่ ClaimCat น่าสงสัย — ส่งให้ BMS/IT แก้ที่ทะเบียนครั้งเดียว ไม่ต้องตามแก้ไฟล์ทุกเดือน
export default function ClaimCatMasterPage() {
  const [days, setDays] = useState(180)
  const [kind, setKind] = useState<ClaimCatMasterItem['kind'] | 'ALL'>('T_OUTSIDE')
  const [onlyUsed, setOnlyUsed] = useState(true)
  const [q, setQ] = useState('')

  const report = useQuery({ queryKey: ['claimcat-master', days], queryFn: () => getClaimCatMaster(days) })
  const data = report.data

  const rows = useMemo(() => {
    const key = q.trim().toLowerCase()
    return (data?.items || [])
      .filter(r => kind === 'ALL' || r.kind === kind)
      .filter(r => !onlyUsed || r.ipd_admissions > 0)
      .filter(r => !key || r.icode.includes(key) || r.name.toLowerCase().includes(key))
  }, [data, kind, onlyUsed, q])

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <Tags className="w-5 h-5 text-violet-600" /> ทะเบียน ClaimCat ใน HOSxP (ผู้ป่วยใน)
        </h2>
        <p className="text-sm text-gray-500 mt-0.5">
          ไฟล์ CIPN ดึง ClaimCat จากทะเบียนรายการค่ารักษาของ HOSxP ไปตรงๆ — แก้ที่ทะเบียนครั้งเดียว ไฟล์ทุกเดือนจะถูกต้องเอง
        </p>
        <div className="mt-3 text-xs text-gray-600 bg-violet-50 border border-violet-100 rounded-lg p-3 space-y-1">
          <div><b>T</b> = เบิกแยกนอก DRG ได้เฉพาะหมวด <b>01</b> ค่าห้อง/อาหาร และ <b>02</b> อวัยวะเทียม/อุปกรณ์บำบัด · <b>D</b> = รวมใน DRG</div>
          <div className="text-gray-500">
            รายการหมวดอื่นที่ตั้งเป็น T ทำให้ยอด XDRGClaim ผิด และไฟล์ติด C 36 (เช่น Hypo-hyperthermia, oral airway, Disp.syring)
            — ส่งรายการในหน้านี้ให้ BMS/IT แก้ที่ทะเบียน · บางรายการเบิกนอก DRG ได้จริงตามเงื่อนไขกรมบัญชีกลาง ให้ศูนย์สิทธิ์ยืนยันก่อนแก้
          </div>
        </div>
      </div>

      {data && (
        <div className="flex flex-wrap gap-2">
          {(['T_OUTSIDE', 'D_ROOM', 'EMPTY', 'ALL'] as const).map(k => (
            <button key={k} type="button" onClick={() => setKind(k)}
              className={clsx('px-3 py-1.5 rounded-lg text-sm border',
                kind === k ? 'border-violet-500 bg-violet-50 text-violet-800 font-medium' : 'border-gray-300 text-gray-600 hover:bg-gray-50')}>
              {k === 'ALL' ? 'ทั้งหมด' : KIND_SHORT[k]}
              {k !== 'ALL' && (
                <span className="ml-1.5 text-xs text-gray-500">
                  ({data.counts[k]} รายการ · ใช้จริง {data.used_counts[k]})
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      <div className="card p-4 flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">นับการใช้กับผู้ป่วยในย้อนหลัง</label>
          <select value={days} onChange={e => setDays(Number(e.target.value))}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white">
            {[90, 180, 365, 730].map(d => <option key={d} value={d}>{d} วัน</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700 h-9">
          <input type="checkbox" checked={onlyUsed} onChange={e => setOnlyUsed(e.target.checked)} />
          เฉพาะรายการที่ใช้กับผู้ป่วยในจริงในช่วงนี้
        </label>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="ค้นหารหัส / ชื่อรายการ"
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-56" />
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={() => report.refetch()} disabled={report.isFetching} className="btn-secondary">
            <RefreshCw className={clsx('w-4 h-4', report.isFetching && 'animate-spin')} /> ดึงใหม่
          </button>
          <button type="button" onClick={() => data && downloadCsv(rows, data.since)} disabled={!rows.length} className="btn-primary">
            <Download className="w-4 h-4" /> ดาวน์โหลด Excel (CSV) {rows.length ? `${rows.length} รายการ` : ''}
          </button>
        </div>
      </div>

      {report.error != null && (
        <div className="card p-4 text-sm text-rose-700 bg-rose-50 border-rose-200">
          {String((report.error as any)?.response?.data?.detail || 'ดึงทะเบียนรายการจาก HOSxP ไม่สำเร็จ')}
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 border-b">
            <tr>
              <th className="px-3 py-2.5 text-left">รหัส</th>
              <th className="px-3 py-2.5 text-left">ชื่อรายการ</th>
              <th className="px-3 py-2.5 text-left">หมวด</th>
              <th className="px-3 py-2.5 text-center">ClaimCat</th>
              <th className="px-3 py-2.5 text-left">ปัญหา</th>
              <th className="px-3 py-2.5 text-right">ราคา</th>
              <th className="px-3 py-2.5 text-right">ใช้กับผู้ป่วยใน</th>
              <th className="px-3 py-2.5 text-left">ใช้ล่าสุด</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map(r => (
              <tr key={r.icode} className={clsx(r.ipd_admissions > 0 && r.kind !== 'EMPTY' && 'bg-rose-50/30')}>
                <td className="px-3 py-2 font-mono text-gray-600">{r.icode}</td>
                <td className="px-3 py-2 text-gray-800">{r.name}</td>
                <td className="px-3 py-2 text-xs text-gray-600"><span className="font-mono">{r.income}</span> {r.income_name}</td>
                <td className="px-3 py-2 text-center font-mono font-bold">{r.claim_cat || <span className="text-gray-300">-</span>}</td>
                <td className="px-3 py-2"><span className={clsx('text-xs rounded-full px-2 py-0.5 whitespace-nowrap', KIND_STYLE[r.kind])}>{KIND_SHORT[r.kind]}</span></td>
                <td className="px-3 py-2 text-right font-mono text-gray-600">{r.price.toLocaleString()}</td>
                <td className="px-3 py-2 text-right font-mono">
                  {r.ipd_admissions > 0
                    ? <span className="inline-flex items-center gap-1 text-rose-700 font-semibold">
                        {r.kind !== 'EMPTY' && <AlertTriangle className="w-3.5 h-3.5" />}{r.ipd_admissions} admit
                      </span>
                    : <span className="text-gray-300">-</span>}
                </td>
                <td className="px-3 py-2 text-xs text-gray-500">{r.last_used || '-'}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">
                {report.isFetching ? 'กำลังอ่านทะเบียนรายการจาก HOSxP...' : 'ไม่มีรายการตามเงื่อนไข'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400 flex items-center gap-1.5">
        <Info className="w-3.5 h-3.5" /> อ่านเฉพาะทะเบียนรายการและจำนวนครั้งที่ใช้ ไม่อ่านข้อมูลผู้ป่วย
      </p>
    </div>
  )
}
