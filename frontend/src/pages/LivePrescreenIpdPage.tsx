import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  BedDouble, RefreshCw, CheckCircle2, XCircle, AlertTriangle, Banknote, ChevronDown, ChevronRight,
  PlugZap, Settings as SettingsIcon, Info,
} from 'lucide-react'
import clsx from 'clsx'
import { getLivePrescreenStatus, runLivePrescreenIpd, type LiveIpdRecord } from '../lib/api'
import LiveTabs from '../components/LiveTabs'
import { ColumnPicker, Pagination, useColumnPrefs, usePagination, type ColumnDef } from '../components/TableTools'

const REFRESH_OPTIONS = [
  { label: 'ปิด', value: 0 },
  { label: '1 นาที', value: 60_000 },
  { label: '5 นาที', value: 300_000 },
  { label: '15 นาที', value: 900_000 },
]
// คอลัมน์ของตาราง — locked = ซ่อนไม่ได้
const IPD_COLUMNS: ColumnDef[] = [
  { id: 'an', label: 'AN', locked: true },
  { id: 'patient', label: 'HN / ชื่อผู้ป่วย' },
  { id: 'admit', label: 'Admit' },
  { id: 'discharge', label: 'จำหน่าย' },
  { id: 'los', label: 'วันนอน' },
  { id: 'pttype', label: 'สิทธิ' },
  { id: 'ward', label: 'หอผู้ป่วย / แผนก' },
  { id: 'doctor', label: 'แพทย์' },
  { id: 'pdx', label: 'PDX' },
  { id: 'drg', label: 'DRG / RW' },
  { id: 'auth', label: 'เลขอนุมัติ' },
  { id: 'charge', label: 'ค่าใช้จ่าย' },
  { id: 'status', label: 'สถานะ', locked: true },
]

const todayStr = () => new Date().toISOString().slice(0, 10)
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10)

// Pre-screen สด ผู้ป่วยใน — ดึงจาก HOSxP เฉพาะเมื่อเปิดหน้านี้ (หน้า OPD ไม่ดึงข้อมูลส่วนนี้)
export default function LivePrescreenIpdPage() {
  const [mode, setMode] = useState<'discharged' | 'admitted'>('discharged')
  const [dateFrom, setDateFrom] = useState(daysAgo(6))
  const [dateTo, setDateTo] = useState(todayStr())
  const [refreshMs, setRefreshMs] = useState(300_000)
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PASSED' | 'FAILED' | 'FLAGGED_C'>('ALL')
  const [wardFilter, setWardFilter] = useState('')
  const [doctorFilter, setDoctorFilter] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const forceNextRef = useRef(false)
  const [now, setNow] = useState(Date.now())

  const statusQuery = useQuery({ queryKey: ['live-prescreen-status'], queryFn: getLivePrescreenStatus })
  const ready = statusQuery.data?.configured && statusQuery.data?.reachable

  const ipdQuery = useQuery({
    queryKey: ['live-prescreen-ipd', mode, dateFrom, dateTo],
    queryFn: () => {
      const force = forceNextRef.current
      forceNextRef.current = false
      return runLivePrescreenIpd({
        mode, force,
        ...(mode === 'discharged' ? { date_from: dateFrom, date_to: dateTo } : {}),
      })
    },
    enabled: !!ready,
    refetchInterval: refreshMs || false,
    refetchIntervalInBackground: false,
  })
  const data = ipdQuery.data

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const doctorOf = (r: LiveIpdRecord) => r.dch_doctor_name || r.admit_doctor_name || ''
  const facets = (get: (r: LiveIpdRecord) => string) => {
    const m = new Map<string, { total: number; bad: number }>()
    for (const r of data?.records || []) {
      const k = get(r) || '(ไม่ระบุ)'
      const v = m.get(k) || { total: 0, bad: 0 }
      v.total += 1
      if (r.status !== 'PASSED') v.bad += 1
      m.set(k, v)
    }
    return [...m.entries()].sort((a, b) => b[1].bad - a[1].bad || b[1].total - a[1].total)
  }
  const wardOptions = useMemo(() => facets(r => r.ward_name), [data])  // eslint-disable-line react-hooks/exhaustive-deps
  const doctorOptions = useMemo(() => facets(doctorOf), [data])  // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    let list = data?.records || []
    if (statusFilter !== 'ALL') list = list.filter(r => r.status === statusFilter)
    if (wardFilter) list = list.filter(r => (r.ward_name || '(ไม่ระบุ)') === wardFilter)
    if (doctorFilter) list = list.filter(r => (doctorOf(r) || '(ไม่ระบุ)') === doctorFilter)
    return list
  }, [data, statusFilter, wardFilter, doctorFilter])  // eslint-disable-line react-hooks/exhaustive-deps

  const cols = useColumnPrefs('mubr_live_ipd_cols', IPD_COLUMNS)
  const pager = usePagination(rows, `${mode}|${statusFilter}|${wardFilter}|${doctorFilter}|${data?.fetched_at ?? ''}`)
  const toggleRow = useCallback((an: string) => setExpanded(e => (e === an ? null : an)), [])

  const fetchedAgo = data ? Math.max(0, Math.round((now - new Date(data.fetched_at).getTime()) / 1000)) : 0
  const nextIn = refreshMs && ipdQuery.dataUpdatedAt
    ? Math.max(0, Math.round((ipdQuery.dataUpdatedAt + refreshMs - now) / 1000)) : null

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <BedDouble className="w-5 h-5 text-indigo-600" /> Pre-screen สด — ผู้ป่วยใน (จากฐาน HOSxP)
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            ตรวจผู้ป่วยในก่อนทำไฟล์ CIPN/AIPN — เลขอนุมัตินอนโรงพยาบาล · ส่วนเกินที่เก็บไม่ได้ · PDX/DRG · วันนอน
          </p>
        </div>
        {data && (
          <div className="text-xs text-gray-500 text-right space-y-0.5">
            <div>
              ข้อมูลจาก HOSxP เมื่อ {new Date(data.fetched_at).toLocaleTimeString('th-TH')}
              <span className="text-gray-400"> ({fetchedAgo} วินาทีที่แล้ว{data.cached ? ' · จากแคช' : ''})</span>
              {ipdQuery.isFetching && <RefreshCw className="w-3.5 h-3.5 inline ml-2 animate-spin text-blue-500" />}
            </div>
            {nextIn !== null && !ipdQuery.isFetching && <div className="text-gray-400">รีเฟรชรอบถัดไปอีก {nextIn} วินาที</div>}
          </div>
        )}
      </div>

      <LiveTabs />

      {statusQuery.data && !ready && (
        <div className="card p-6 border-amber-200 bg-amber-50 flex items-start gap-3">
          <PlugZap className="w-6 h-6 text-amber-500 flex-shrink-0" />
          <div>
            <p className="font-semibold text-amber-800">
              {statusQuery.data.configured ? 'เชื่อมต่อฐาน HOSxP ไม่ได้' : 'ยังไม่ได้ตั้งค่าเชื่อมต่อฐาน HOSxP'}
            </p>
            <p className="text-sm text-amber-700 mt-1">{statusQuery.data.message}</p>
            <Link to="/system-settings" className="inline-flex items-center gap-1.5 mt-3 text-sm font-medium text-blue-700 hover:underline">
              <SettingsIcon className="w-4 h-4" /> ไปหน้าตั้งค่าระบบ → การเชื่อมต่อฐาน HOSxP (เฉพาะ ADMIN)
            </Link>
          </div>
        </div>
      )}

      {/* ตัวควบคุม */}
      <div className="card p-4 flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">แสดง</label>
          <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden text-sm">
            {([['discharged', 'จำหน่ายแล้ว'], ['admitted', 'กำลังนอน']] as const).map(([k, label]) => (
              <button key={k} type="button" onClick={() => { setMode(k); setWardFilter(''); setDoctorFilter('') }}
                className={clsx('px-3 py-1.5', mode === k ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50')}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {mode === 'discharged' && (
          <>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">จำหน่ายตั้งแต่</label>
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">ถึง</label>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
            </div>
          </>
        )}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">หอผู้ป่วย</label>
          <select value={wardFilter} onChange={e => setWardFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white max-w-[14rem]">
            <option value="">ทุกหอผู้ป่วย</option>
            {wardOptions.map(([n, c]) => <option key={n} value={n}>{n} ({c.total}{c.bad ? ` · มีปัญหา ${c.bad}` : ''})</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">แพทย์</label>
          <select value={doctorFilter} onChange={e => setDoctorFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white max-w-[14rem]">
            <option value="">ทุกแพทย์</option>
            {doctorOptions.map(([n, c]) => <option key={n} value={n}>{n} ({c.total}{c.bad ? ` · มีปัญหา ${c.bad}` : ''})</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">รีเฟรชอัตโนมัติ</label>
          <select value={refreshMs} onChange={e => setRefreshMs(Number(e.target.value))}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white">
            {REFRESH_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <button onClick={() => { forceNextRef.current = true; ipdQuery.refetch() }}
          disabled={!ready || ipdQuery.isFetching}
          className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
          <RefreshCw className={clsx('w-4 h-4', ipdQuery.isFetching && 'animate-spin')} /> ดึงข้อมูลตอนนี้
        </button>
      </div>

      {ipdQuery.error != null && (
        <div className="card p-4 text-sm text-rose-700 bg-rose-50 border-rose-200">
          {String((ipdQuery.error as any)?.response?.data?.detail || 'ดึงข้อมูลผู้ป่วยในไม่สำเร็จ')}
        </div>
      )}

      {data && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card label={mode === 'admitted' ? 'กำลังนอน' : 'จำหน่าย'} value={data.summary.total} icon={<BedDouble className="w-5 h-5" />}
            color="indigo" active={statusFilter === 'ALL'} onClick={() => setStatusFilter('ALL')} />
          <Card label="ผ่าน" value={data.summary.passed} icon={<CheckCircle2 className="w-5 h-5" />} color="emerald"
            active={statusFilter === 'PASSED'} onClick={() => setStatusFilter('PASSED')} />
          <Card label="ไม่ผ่าน" value={data.summary.failed} icon={<XCircle className="w-5 h-5" />} color="rose"
            active={statusFilter === 'FAILED'} onClick={() => setStatusFilter('FAILED')} />
          <Card label="เสี่ยงติด C" value={data.summary.flagged_c} icon={<AlertTriangle className="w-5 h-5" />} color="amber"
            active={statusFilter === 'FLAGGED_C'} onClick={() => setStatusFilter('FLAGGED_C')} />
          <Card label="ค่าใช้จ่ายรวม (บาท)" value={data.summary.total_amount.toLocaleString()} icon={<Banknote className="w-5 h-5" />} color="gray" />
        </div>
      )}

      {mode === 'admitted' && data && (
        <p className="text-xs text-gray-500 flex items-center gap-1.5">
          <Info className="w-3.5 h-3.5" /> ผู้ป่วยที่ยังนอนอยู่ ยังไม่ตรวจเรื่องวันจำหน่าย PDX DRG — ตรวจเลขอนุมัตินอนโรงพยาบาลและส่วนเกินล่วงหน้าได้
        </p>
      )}

      {/* ตาราง — เลื่อนซ้ายขวาได้ หัวตารางและ AN ติดอยู่กับที่ */}
      <div className="card overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-2 border-b bg-white">
          <span className="text-xs text-gray-500">คลิกแถวเพื่อดูปัญหา · ตารางกว้างเลื่อนซ้ายขวาได้</span>
          <ColumnPicker prefs={cols} />
        </div>
        <div className="overflow-auto max-h-[70vh]">
          <table className="w-full text-sm min-w-max">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide border-b sticky top-0 z-10">
              <tr>
                <th className="px-3 py-3 w-8 bg-gray-50"></th>
                <th className="px-3 py-3 text-left bg-gray-50 sticky left-0 z-20">AN</th>
                {cols.show('patient') && <th className="px-3 py-3 text-left">HN / ชื่อผู้ป่วย</th>}
                {cols.show('admit') && <th className="px-3 py-3 text-left">Admit</th>}
                {cols.show('discharge') && <th className="px-3 py-3 text-left">จำหน่าย</th>}
                {cols.show('los') && <th className="px-3 py-3 text-right">วันนอน</th>}
                {cols.show('pttype') && <th className="px-3 py-3 text-left">สิทธิ</th>}
                {cols.show('ward') && <th className="px-3 py-3 text-left">หอผู้ป่วย / แผนก</th>}
                {cols.show('doctor') && <th className="px-3 py-3 text-left">แพทย์</th>}
                {cols.show('pdx') && <th className="px-3 py-3 text-left">PDX</th>}
                {cols.show('drg') && <th className="px-3 py-3 text-left">DRG / RW</th>}
                {cols.show('auth') && <th className="px-3 py-3 text-left">เลขอนุมัติ</th>}
                {cols.show('charge') && <th className="px-3 py-3 text-right">ค่าใช้จ่าย</th>}
                <th className="px-3 py-3 text-left">สถานะ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pager.slice.map(r => (
                <IpdRow key={r.an} r={r} expanded={expanded === r.an} onToggle={toggleRow}
                  show={cols.show} colCount={cols.visibleCount + 1} />
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={cols.visibleCount + 1} className="px-4 py-12 text-center text-gray-400">
                  {ipdQuery.isFetching ? 'กำลังดึงข้อมูลผู้ป่วยในจาก HOSxP...' : !ready ? 'รอการเชื่อมต่อฐาน HOSxP' : 'ไม่พบผู้ป่วยในตามเงื่อนไขที่เลือก'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination p={pager} />
      </div>
    </div>
  )
}

function Card({ label, value, icon, color, active, onClick }: {
  label: string; value: number | string; icon: React.ReactNode; color: string; active?: boolean; onClick?: () => void
}) {
  const colors: Record<string, string> = {
    indigo: 'text-indigo-600 bg-indigo-50', emerald: 'text-emerald-600 bg-emerald-50',
    rose: 'text-rose-600 bg-rose-50', amber: 'text-amber-600 bg-amber-50', gray: 'text-gray-600 bg-gray-100',
  }
  return (
    <button onClick={onClick} disabled={!onClick}
      className={clsx('card p-4 flex items-center gap-3 text-left transition-all',
        onClick && 'hover:shadow-md cursor-pointer', active && 'ring-2 ring-indigo-400')}>
      <div className={clsx('p-2 rounded-lg', colors[color])}>{icon}</div>
      <div>
        <p className="text-xs text-gray-500">{label}</p>
        <p className="text-xl font-bold text-gray-900">{value}</p>
      </div>
    </button>
  )
}

// memo: แถวที่ข้อมูลไม่เปลี่ยนไม่ต้อง render ใหม่ทุกรอบรีเฟรช/นาฬิกา
const IpdRow = memo(function IpdRow({ r, expanded, onToggle, show, colCount }: {
  r: LiveIpdRecord; expanded: boolean; onToggle: (an: string) => void
  show: (id: string) => boolean; colCount: number
}) {
  const badge = {
    PASSED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    FAILED: 'bg-rose-50 text-rose-700 border-rose-200',
    FLAGGED_C: 'bg-amber-50 text-amber-700 border-amber-200',
  }[r.status]
  const label = { PASSED: 'ผ่าน', FAILED: 'ไม่ผ่าน', FLAGGED_C: 'เสี่ยงติด C' }[r.status]
  const errCount = r.errors.filter(e => e.severity === 'ERROR').length
  const warnCount = r.errors.filter(e => e.severity === 'WARNING').length
  return (
    <>
      <tr onClick={() => onToggle(r.an)} className={clsx('cursor-pointer hover:bg-indigo-50/40', r.status !== 'PASSED' && 'bg-rose-50/20')}>
        <td className="px-3 py-2.5 text-gray-400">
          {r.errors.length > 0 ? (expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />) : null}
        </td>
        <td className={clsx('px-3 py-2.5 font-mono text-gray-700 sticky left-0 whitespace-nowrap',
          r.status !== 'PASSED' ? 'bg-rose-50' : 'bg-white')}>{r.an}</td>
        {show('patient') && (
          <td className="px-3 py-2.5 text-xs leading-tight whitespace-nowrap">
            <div className="font-mono text-blue-800">{r.hn || '-'}</div>
            <div className="text-gray-800">{r.patient_name || '-'}</div>
          </td>
        )}
        {show('admit') && <td className="px-3 py-2.5 text-xs text-gray-600 whitespace-nowrap">{r.admit_date} {r.admit_time?.slice(0, 5)}</td>}
        {show('discharge') && (
          <td className="px-3 py-2.5 text-xs text-gray-600 whitespace-nowrap">
            {r.discharge_date ? <>{r.discharge_date} {r.discharge_time?.slice(0, 5)}</> : <span className="text-indigo-600">ยังนอนอยู่</span>}
          </td>
        )}
        {show('los') && <td className="px-3 py-2.5 text-right font-mono">{r.los ?? '-'}</td>}
        {show('pttype') && (
          <td className="px-3 py-2.5 text-xs leading-tight">
            <div className="font-mono text-gray-500">{r.pttype}</div>
            {r.pttype_name && <div className="text-gray-800 whitespace-nowrap">{r.pttype_name}</div>}
          </td>
        )}
        {show('ward') && (
          <td className="px-3 py-2.5 text-xs leading-tight whitespace-nowrap">
            <div className="text-gray-800">{r.ward_name || '-'}</div>
            <div className="text-gray-500">{r.spclty_name}</div>
          </td>
        )}
        {show('doctor') && (
          <td className="px-3 py-2.5 text-xs leading-tight text-gray-800 whitespace-nowrap">
            {r.dch_doctor_name || r.admit_doctor_name || <span className="text-gray-400">-</span>}
            {r.dch_doctor_name && r.admit_doctor_name && r.admit_doctor_name !== r.dch_doctor_name && (
              <div className="text-gray-400">admit: {r.admit_doctor_name}</div>
            )}
          </td>
        )}
        {show('pdx') && <td className="px-3 py-2.5 font-mono text-xs">{r.pdx || <span className="text-gray-400">-</span>}</td>}
        {show('drg') && (
          <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap">
            {r.drg || '-'}{r.rw != null && <span className="text-gray-400"> / {r.rw}</span>}
          </td>
        )}
        {show('auth') && <td className="px-3 py-2.5 font-mono text-xs">{r.auth_code || <span className="text-gray-400">-</span>}</td>}
        {show('charge') && <td className="px-3 py-2.5 text-right font-mono">{r.total_charge.toLocaleString()}</td>}
        <td className="px-3 py-2.5 text-xs whitespace-nowrap">
          <span className={clsx('inline-block px-2 py-0.5 rounded-full font-semibold border', badge)}>{label}</span>
          {errCount > 0 && <div className="text-rose-600 mt-0.5">{errCount} ข้อผิดพลาด</div>}
          {warnCount > 0 && <div className="text-amber-600">{warnCount} เตือน</div>}
        </td>
      </tr>
      {expanded && r.errors.length > 0 && (
        <tr>
          <td colSpan={colCount} className="bg-gray-50 px-6 py-3">
            <ul className="space-y-1.5">
              {r.errors.map((e, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  {e.severity === 'ERROR'
                    ? <XCircle className="w-4 h-4 text-rose-500 mt-0.5 flex-shrink-0" />
                    : e.severity === 'INFO'
                      ? <Info className="w-4 h-4 text-sky-500 mt-0.5 flex-shrink-0" />
                      : <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />}
                  <span>
                    <span className="font-mono text-xs bg-gray-200 rounded px-1.5 py-0.5 mr-2">{e.code}</span>
                    {e.message_th}
                    {e.current_value && <span className="text-gray-400 ml-1">(ค่าปัจจุบัน: {e.current_value})</span>}
                  </span>
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}
    </>
  )
})
