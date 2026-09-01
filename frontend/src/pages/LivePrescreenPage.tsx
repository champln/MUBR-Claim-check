import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  Radio, RefreshCw, CheckCircle2, XCircle, AlertTriangle, Banknote,
  ChevronDown, ChevronRight, PlugZap, Settings as SettingsIcon, PauseCircle,
} from 'lucide-react'
import clsx from 'clsx'
import {
  getLivePrescreenStatus, runLivePrescreen,
  type LivePrescreenRecord,
} from '../lib/api'

const REFRESH_OPTIONS = [
  { label: 'ปิด', value: 0 },
  { label: '30 วินาที', value: 30_000 },
  { label: '1 นาที', value: 60_000 },
  { label: '5 นาที', value: 300_000 },
]

const todayStr = () => new Date().toISOString().slice(0, 10)

export default function LivePrescreenPage() {
  const [dateFrom, setDateFrom] = useState(todayStr())
  const [dateTo, setDateTo] = useState(todayStr())
  const [pttype, setPttype] = useState('')          // ว่าง = ทุกสิทธิ
  const [refreshMs, setRefreshMs] = useState(60_000)
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PASSED' | 'FAILED' | 'FLAGGED_C'>('ALL')
  const [expanded, setExpanded] = useState<string | null>(null)

  const statusQuery = useQuery({
    queryKey: ['live-prescreen-status'],
    queryFn: getLivePrescreenStatus,
    refetchInterval: 5 * 60_000,
  })

  const ready = statusQuery.data?.configured && statusQuery.data?.reachable

  const liveQuery = useQuery({
    queryKey: ['live-prescreen', dateFrom, dateTo, pttype],
    queryFn: () => runLivePrescreen({
      date_from: dateFrom, date_to: dateTo,
      pttype: pttype.trim() || undefined,
    }),
    enabled: !!ready,
    refetchInterval: refreshMs || false,
    refetchIntervalInBackground: false,
  })

  const data = liveQuery.data
  const rows = useMemo(() => {
    if (!data) return []
    if (statusFilter === 'ALL') return data.records
    return data.records.filter(r => r.status === statusFilter)
  }, [data, statusFilter])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Radio className="w-5 h-5 text-blue-600" /> Pre-screen สด (จากฐาน HOSxP)
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            ดึง visit จาก HOSxP มาตรวจทันทีโดยไม่ต้อง export ไฟล์ — รีเฟรชอัตโนมัติตามรอบเวลา
          </p>
        </div>
        {data && (
          <div className="text-xs text-gray-400">
            อัปเดตล่าสุด {new Date(data.fetched_at).toLocaleTimeString('th-TH')}
            {liveQuery.isFetching && <RefreshCw className="w-3.5 h-3.5 inline ml-2 animate-spin text-blue-500" />}
          </div>
        )}
      </div>

      {/* สถานะการเชื่อมต่อ */}
      {statusQuery.data && !ready && (
        <div className="card p-6 border-amber-200 bg-amber-50">
          <div className="flex items-start gap-3">
            <PlugZap className="w-6 h-6 text-amber-500 flex-shrink-0" />
            <div className="flex-1">
              <p className="font-semibold text-amber-800">
                {statusQuery.data.configured ? 'เชื่อมต่อฐาน HOSxP ไม่ได้' : 'ยังไม่ได้ตั้งค่าเชื่อมต่อฐาน HOSxP'}
              </p>
              <p className="text-sm text-amber-700 mt-1">{statusQuery.data.message}</p>
              <Link to="/settings" className="inline-flex items-center gap-1.5 mt-3 text-sm font-medium text-blue-700 hover:underline">
                <SettingsIcon className="w-4 h-4" /> ไปหน้าตั้งค่า → การเชื่อมต่อ HOSxP
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* ตัวควบคุม */}
      <div className="card p-4 flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">จากวันที่</label>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">ถึงวันที่</label>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">สิทธิ (pttype, คั่นด้วย ,)</label>
          <input type="text" value={pttype} onChange={e => setPttype(e.target.value)} placeholder="เช่น 21 (ว่าง = ทุกสิทธิ)"
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-44" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">รีเฟรชอัตโนมัติ</label>
          <select value={refreshMs} onChange={e => setRefreshMs(Number(e.target.value))}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white">
            {REFRESH_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <button
          onClick={() => liveQuery.refetch()}
          disabled={!ready || liveQuery.isFetching}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          <RefreshCw className={clsx('w-4 h-4', liveQuery.isFetching && 'animate-spin')} /> ดึงข้อมูลตอนนี้
        </button>
        {refreshMs === 0 && (
          <span className="text-xs text-gray-400 flex items-center gap-1"><PauseCircle className="w-3.5 h-3.5" /> ปิดรีเฟรชอัตโนมัติ</span>
        )}
      </div>

      {/* สรุปผล */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <SummaryCard label="Visit ทั้งหมด" value={data.summary.total} icon={<Radio className="w-5 h-5" />} color="blue"
            active={statusFilter === 'ALL'} onClick={() => setStatusFilter('ALL')} />
          <SummaryCard label="ผ่าน" value={data.summary.passed} icon={<CheckCircle2 className="w-5 h-5" />} color="emerald"
            active={statusFilter === 'PASSED'} onClick={() => setStatusFilter('PASSED')} />
          <SummaryCard label="ไม่ผ่าน" value={data.summary.failed} icon={<XCircle className="w-5 h-5" />} color="rose"
            active={statusFilter === 'FAILED'} onClick={() => setStatusFilter('FAILED')} />
          <SummaryCard label="เสี่ยงติด C" value={data.summary.flagged_c} icon={<AlertTriangle className="w-5 h-5" />} color="amber"
            active={statusFilter === 'FLAGGED_C'} onClick={() => setStatusFilter('FLAGGED_C')} />
          <SummaryCard label="ยอดรวม (บาท)" value={data.summary.total_amount.toLocaleString()} icon={<Banknote className="w-5 h-5" />} color="gray" />
        </div>
      )}

      {/* ตาราง */}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide border-b">
            <tr>
              <th className="px-3 py-3 w-8"></th>
              <th className="px-3 py-3 text-left">VN</th>
              <th className="px-3 py-3 text-left">HN</th>
              <th className="px-3 py-3 text-left">ชื่อผู้ป่วย</th>
              <th className="px-3 py-3 text-left">วันที่</th>
              <th className="px-3 py-3 text-left">สิทธิ</th>
              <th className="px-3 py-3 text-left">PDX</th>
              <th className="px-3 py-3 text-right">ค่าใช้จ่าย</th>
              <th className="px-3 py-3 text-left">สถานะ</th>
              <th className="px-3 py-3 text-left">ปัญหา</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r) => (
              <LiveRow key={r.vn} r={r} expanded={expanded === r.vn}
                onToggle={() => setExpanded(expanded === r.vn ? null : r.vn)} />
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-12 text-center text-gray-400">
                  {liveQuery.isFetching ? 'กำลังดึงข้อมูลจาก HOSxP...' :
                   !ready ? 'รอการเชื่อมต่อฐาน HOSxP' : 'ไม่พบ visit ในช่วงเวลา/เงื่อนไขที่เลือก'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SummaryCard({ label, value, icon, color, active, onClick }: {
  label: string; value: number | string; icon: React.ReactNode; color: string
  active?: boolean; onClick?: () => void
}) {
  const colors: Record<string, string> = {
    blue: 'text-blue-600 bg-blue-50', emerald: 'text-emerald-600 bg-emerald-50',
    rose: 'text-rose-600 bg-rose-50', amber: 'text-amber-600 bg-amber-50', gray: 'text-gray-600 bg-gray-100',
  }
  return (
    <button onClick={onClick} disabled={!onClick}
      className={clsx('card p-4 flex items-center gap-3 text-left transition-all',
        onClick && 'hover:shadow-md cursor-pointer', active && 'ring-2 ring-blue-400')}>
      <div className={clsx('p-2 rounded-lg', colors[color])}>{icon}</div>
      <div>
        <p className="text-xs text-gray-500">{label}</p>
        <p className="text-xl font-bold text-gray-900">{value}</p>
      </div>
    </button>
  )
}

function LiveRow({ r, expanded, onToggle }: { r: LivePrescreenRecord; expanded: boolean; onToggle: () => void }) {
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
      <tr onClick={onToggle} className={clsx('cursor-pointer hover:bg-blue-50/40', r.status !== 'PASSED' && 'bg-rose-50/20')}>
        <td className="px-3 py-2.5 text-gray-400">
          {r.errors.length > 0 ? (expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />) : null}
        </td>
        <td className="px-3 py-2.5 font-mono text-gray-600">{r.vn}</td>
        <td className="px-3 py-2.5 font-mono text-blue-800">{r.hn || '-'}</td>
        <td className="px-3 py-2.5 text-gray-800">{r.patient_name || '-'}</td>
        <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">{r.visit_date} {r.visit_time?.slice(0, 5)}</td>
        <td className="px-3 py-2.5 text-gray-500">{r.pttype}</td>
        <td className="px-3 py-2.5 font-mono">{r.pdx || <span className="text-rose-500 font-bold">ไม่มี</span>}</td>
        <td className="px-3 py-2.5 text-right font-mono">{r.total_charge.toLocaleString()}</td>
        <td className="px-3 py-2.5">
          <span className={clsx('inline-block px-2 py-0.5 rounded-full text-xs font-semibold border', badge)}>{label}</span>
        </td>
        <td className="px-3 py-2.5 text-xs">
          {errCount > 0 && <span className="text-rose-600 font-semibold mr-2">{errCount} ข้อผิดพลาด</span>}
          {warnCount > 0 && <span className="text-amber-600">{warnCount} เตือน</span>}
          {r.errors.length === 0 && <span className="text-gray-300">—</span>}
        </td>
      </tr>
      {expanded && r.errors.length > 0 && (
        <tr>
          <td colSpan={10} className="bg-gray-50 px-6 py-3">
            <ul className="space-y-1.5">
              {r.errors.map((e, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  {e.severity === 'ERROR'
                    ? <XCircle className="w-4 h-4 text-rose-500 mt-0.5 flex-shrink-0" />
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
}
