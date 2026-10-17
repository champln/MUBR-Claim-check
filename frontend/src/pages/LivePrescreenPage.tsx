import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import {
  Radio, RefreshCw, CheckCircle2, XCircle, AlertTriangle, Banknote,
  ChevronDown, ChevronRight, PlugZap, Settings as SettingsIcon, PauseCircle, Info,
  ShieldCheck, Bell, BellOff, Sparkles, Download, BarChart3, X,
} from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import {
  getLivePrescreenStatus, runLivePrescreen, getLiveReadiness, exportLivePrescreen,
  type LivePrescreenRecord,
} from '../lib/api'
import LiveTabs from '../components/LiveTabs'
import PttypePicker from '../components/PttypePicker'
import { ColumnPicker, Pagination, useColumnPrefs, usePagination, type ColumnDef } from '../components/TableTools'

// เสียงเตือนสั้นๆ เมื่อมี visit ใหม่ที่มีปัญหา (Web Audio — ไม่ต้องใช้ไฟล์เสียง)
function beep() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.15, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4)
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.4)
  } catch { /* เบราว์เซอร์ไม่รองรับ ไม่เป็นไร */ }
}

const SOUND_KEY = 'mubr_live_sound'

// คอลัมน์ของตาราง — locked = ซ่อนไม่ได้
const OPD_COLUMNS: ColumnDef[] = [
  { id: 'vn', label: 'VN', locked: true },
  { id: 'hn', label: 'HN' },
  { id: 'name', label: 'ชื่อผู้ป่วย' },
  { id: 'date', label: 'วันที่' },
  { id: 'pttype', label: 'สิทธิ' },
  { id: 'dept', label: 'แผนก / ห้องตรวจ' },
  { id: 'doctor', label: 'แพทย์ผู้ตรวจ' },
  { id: 'pdx', label: 'PDX' },
  { id: 'charge', label: 'ค่าใช้จ่าย' },
  { id: 'status', label: 'สถานะ', locked: true },
  { id: 'issues', label: 'ปัญหา' },
]

const REFRESH_OPTIONS = [
  { label: '30 วินาที', value: 30_000 },
  { label: '1 นาที', value: 60_000 },
  { label: '5 นาที', value: 300_000 },
]
const REFRESH_KEY = 'mubr_live_refresh'   // { on: boolean, ms: number }

// ชื่อสั้นของรหัสปัญหา — ใช้ในสรุปตามรหัส (รหัสที่ไม่มีในนี้ใช้ข้อความแรกที่พบแทน)
const CODE_TITLES: Record<string, string> = {
  BND01: 'เวชภัณฑ์ที่เหมารวมในค่าหัตถการ',
  ORD01: 'ผู้สั่งหัตถการไม่ใช่แพทย์ (เสี่ยง T84)',
  V02: 'Lab COVID ต้องใส่ AuthCode COV-19',
  PAY01: 'รายการเบิกไม่ได้ แต่คิดเป็นลูกหนี้สิทธิ',
  Q04: 'อวัยวะเทียม/อุปกรณ์หมวด 2 ใน OPD',
  C05: 'visit คนเดียวกันเวลาเดียวกัน',
  G06: 'ยาไม่มีรหัส TMT',
  L01: 'Lab ไม่มีรหัส TMLT',
  S48: 'แพทย์ผู้ตรวจไม่มีเลข ว.',
  FEE001: 'ค่าธรรมเนียม 50 บาทคิดซ้ำ',
  FEE002: 'ค่าธรรมเนียมคิดเป็นลูกหนี้สิทธิ',
  FEE003: 'แผนกที่ไม่คิดค่าธรรมเนียม',
  FEE004: 'พบแพทย์คนใหม่แต่ไม่ได้คิดค่าธรรมเนียม',
  R24: 'วิธีใช้ยาว่าง / มีอักขระต้องห้าม',
  T42: 'วันที่รายการไม่ตรงวัน visit',
  T33: 'ค่าบริการผู้ป่วยนอกไม่ได้คิดเป็นลูกหนี้',
  G04: 'เหตุผลการใช้ยานอกบัญชี',
  S41: 'รหัสหัตถการ (ICD-9)',
  P02: 'เลขอนุมัติ CPAP/PSG',
  P05: 'แพทย์ผู้สั่ง CPAP/PSG',
}

function loadRefresh(): { on: boolean; ms: number } {
  try {
    const v = JSON.parse(localStorage.getItem(REFRESH_KEY) || 'null')
    if (v && typeof v.on === 'boolean' && REFRESH_OPTIONS.some(o => o.value === v.ms)) return v
  } catch { /* ใช้ค่าเริ่มต้น */ }
  return { on: true, ms: 60_000 }
}

const todayStr = () => new Date().toISOString().slice(0, 10)

export default function LivePrescreenPage() {
  const [dateFrom, setDateFrom] = useState(todayStr())
  const [dateTo, setDateTo] = useState(todayStr())
  const [pttype, setPttype] = useState('')          // ว่าง = ทุกสิทธิ
  const [refresh, setRefresh] = useState(loadRefresh)   // เปิด/ปิดรีเฟรชอัตโนมัติ + รอบเวลา (จำไว้ในเครื่อง)
  const refreshMs = refresh.on ? refresh.ms : 0
  const [codeFilter, setCodeFilter] = useState('')   // รหัสปัญหา (จากสรุปตามรหัส)
  const [showSummary, setShowSummary] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'PASSED' | 'FAILED' | 'FLAGGED_C'>('ALL')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [deptFilter, setDeptFilter] = useState('')   // แผนก (spclty)
  const [roomFilter, setRoomFilter] = useState('')   // ห้องตรวจ (main_dep)
  const [doctorFilter, setDoctorFilter] = useState('') // แพทย์ผู้ตรวจ
  const forceNextRef = useRef(false)                // กด "ดึงข้อมูลตอนนี้" -> รอบนั้นรอบเดียวข้ามแคชเซิร์ฟเวอร์
  const [newVns, setNewVns] = useState<Set<string>>(new Set())
  const seenRef = useRef<{ key: string; vns: Set<string> } | null>(null)
  const [sound, setSound] = useState(() => {
    try { return localStorage.getItem(SOUND_KEY) === '1' } catch { return false }
  })
  const [now, setNow] = useState(Date.now())

  const statusQuery = useQuery({
    queryKey: ['live-prescreen-status'],
    queryFn: getLivePrescreenStatus,
    refetchInterval: 5 * 60_000,
  })

  const ready = statusQuery.data?.configured && statusQuery.data?.reachable

  const readinessQuery = useQuery({
    queryKey: ['live-readiness'],
    queryFn: getLiveReadiness,
    enabled: !!ready,
    staleTime: 30 * 60_000,
    retry: false,
  })

  const liveQuery = useQuery({
    queryKey: ['live-prescreen', dateFrom, dateTo, pttype],
    queryFn: () => {
      const force = forceNextRef.current
      forceNextRef.current = false
      return runLivePrescreen({
        date_from: dateFrom, date_to: dateTo,
        pttype: pttype.trim() || undefined,
        force,
      })
    },
    enabled: !!ready,
    refetchInterval: refreshMs || false,
    refetchIntervalInBackground: false,
  })

  const data = liveQuery.data

  // นาฬิกาสำหรับ "อัปเดตเมื่อ x วินาทีที่แล้ว / รอบถัดไปอีก y วินาที"
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // หา visit ที่เพิ่งเข้ามาตั้งแต่รอบก่อน (เงื่อนไขเดิม) + เสียงเตือนถ้าเป็นเคสมีปัญหา
  useEffect(() => {
    if (!data) return
    const key = `${data.date_from}|${data.date_to}|${(data.pttype || []).join(',')}`
    const vns = new Set(data.records.map(r => r.vn))
    const prev = seenRef.current
    if (prev && prev.key === key) {
      const fresh = new Set([...vns].filter(v => !prev.vns.has(v)))
      setNewVns(fresh)
      const freshProblem = data.records.some(r => fresh.has(r.vn) && r.status !== 'PASSED')
      if (freshProblem && sound) beep()
    } else {
      setNewVns(new Set())
    }
    seenRef.current = { key, vns }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  useEffect(() => {
    try { localStorage.setItem(REFRESH_KEY, JSON.stringify(refresh)) } catch { /* ignore */ }
  }, [refresh])

  const toggleSound = () => setSound(s => {
    const next = !s
    try { localStorage.setItem(SOUND_KEY, next ? '1' : '0') } catch { /* ignore */ }
    if (next) beep()
    return next
  })

  // ตัวเลือกแผนก / ห้องตรวจ จากข้อมูลรอบนี้ พร้อมจำนวน visit ที่มีปัญหา
  const facets = (key: 'spclty_name' | 'main_dep_name' | 'doctor_name') => {
    const m = new Map<string, { total: number; bad: number }>()
    for (const r of data?.records || []) {
      const k = r[key] || '(ไม่ระบุ)'
      const v = m.get(k) || { total: 0, bad: 0 }
      v.total += 1
      if (r.status !== 'PASSED') v.bad += 1
      m.set(k, v)
    }
    return [...m.entries()].sort((a, b) => b[1].bad - a[1].bad || b[1].total - a[1].total)
  }
  const deptOptions = useMemo(() => facets('spclty_name'), [data])  // eslint-disable-line react-hooks/exhaustive-deps
  const roomOptions = useMemo(() => facets('main_dep_name'), [data])  // eslint-disable-line react-hooks/exhaustive-deps
  const doctorOptions = useMemo(() => facets('doctor_name'), [data])  // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    if (!data) return []
    let list = statusFilter === 'ALL' ? data.records : data.records.filter(r => r.status === statusFilter)
    if (deptFilter) list = list.filter(r => (r.spclty_name || '(ไม่ระบุ)') === deptFilter)
    if (roomFilter) list = list.filter(r => (r.main_dep_name || '(ไม่ระบุ)') === roomFilter)
    if (doctorFilter) list = list.filter(r => (r.doctor_name || '(ไม่ระบุ)') === doctorFilter)
    if (codeFilter) list = list.filter(r => r.errors.some(e => e.code === codeFilter))
    // visit ใหม่ขึ้นก่อน แล้วตามลำดับเดิม (ล่าสุดก่อน)
    return [...list].sort((a, b) => Number(newVns.has(b.vn)) - Number(newVns.has(a.vn)))
  }, [data, statusFilter, newVns, deptFilter, roomFilter, doctorFilter, codeFilter])

  // สรุปปัญหาตามรหัส / ตามแผนก จากข้อมูลทั้งรอบ (ไม่ขึ้นกับตัวกรอง — คลิกเพื่อกรองตาราง)
  const issueSummary = useMemo(() => {
    const codes = new Map<string, { sev: string; issues: number; vns: Set<string>; example: string }>()
    const depts = new Map<string, { total: number; bad: number; err: number; warn: number; codes: Map<string, number> }>()
    for (const r of data?.records || []) {
      const dname = r.spclty_name || '(ไม่ระบุ)'
      const d = depts.get(dname) || { total: 0, bad: 0, err: 0, warn: 0, codes: new Map() }
      d.total += 1
      if (r.status !== 'PASSED') d.bad += 1
      for (const e of r.errors) {
        const c = codes.get(e.code) || { sev: e.severity, issues: 0, vns: new Set<string>(), example: e.message_th }
        c.issues += 1
        c.vns.add(r.vn)
        if (e.severity === 'ERROR') c.sev = 'ERROR'
        codes.set(e.code, c)
        if (e.severity === 'ERROR') d.err += 1
        else if (e.severity === 'WARNING') d.warn += 1
        d.codes.set(e.code, (d.codes.get(e.code) || 0) + 1)
      }
      depts.set(dname, d)
    }
    const sevRank: Record<string, number> = { ERROR: 0, WARNING: 1, INFO: 2 }
    return {
      codes: [...codes.entries()].sort((a, b) =>
        (sevRank[a[1].sev] ?? 3) - (sevRank[b[1].sev] ?? 3) || b[1].vns.size - a[1].vns.size),
      depts: [...depts.entries()].filter(([, v]) => v.err + v.warn > 0)
        .sort((a, b) => b[1].bad - a[1].bad || (b[1].err + b[1].warn) - (a[1].err + a[1].warn)),
    }
  }, [data])

  const doExport = async () => {
    if (!rows.length) return
    setExporting(true)
    try {
      const parts = [dateFrom === dateTo ? dateFrom : `${dateFrom} ถึง ${dateTo}`]
      if (codeFilter) parts.push(`รหัส ${codeFilter}`)
      if (deptFilter) parts.push(deptFilter)
      await exportLivePrescreen(rows, `Pre-screen สด ผู้ป่วยนอก ${parts.join(' · ')}`)
    } catch {
      toast.error('ส่งออก Excel ไม่สำเร็จ')
    } finally {
      setExporting(false)
    }
  }

  const cols = useColumnPrefs('mubr_live_opd_cols', OPD_COLUMNS)
  const pager = usePagination(rows, `${statusFilter}|${deptFilter}|${roomFilter}|${doctorFilter}|${codeFilter}|${data?.fetched_at ?? ''}`)
  const toggleRow = useCallback((vn: string) => setExpanded(e => (e === vn ? null : vn)), [])

  const fetchedAgo = data ? Math.max(0, Math.round((now - new Date(data.fetched_at).getTime()) / 1000)) : 0
  const nextIn = refreshMs && liveQuery.dataUpdatedAt
    ? Math.max(0, Math.round((liveQuery.dataUpdatedAt + refreshMs - now) / 1000)) : null
  const newProblem = data ? data.records.filter(r => newVns.has(r.vn) && r.status !== 'PASSED').length : 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Radio className="w-5 h-5 text-blue-600" /> Pre-screen สด — ผู้ป่วยนอก (จากฐาน HOSxP)
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            ดึง visit จาก HOSxP มาตรวจทันทีโดยไม่ต้อง export ไฟล์ — เปิดรีเฟรชอัตโนมัติได้ตามรอบเวลา
          </p>
        </div>
        {data && (
          <div className="text-xs text-gray-500 text-right space-y-0.5">
            <div>
              ข้อมูลจาก HOSxP เมื่อ {new Date(data.fetched_at).toLocaleTimeString('th-TH')}
              <span className="text-gray-400"> ({fetchedAgo} วินาทีที่แล้ว{data.cached ? ' · จากแคช' : ''})</span>
              {liveQuery.isFetching && <RefreshCw className="w-3.5 h-3.5 inline ml-2 animate-spin text-blue-500" />}
            </div>
            {nextIn !== null && !liveQuery.isFetching && (
              <div className="text-gray-400">รีเฟรชรอบถัดไปอีก {nextIn} วินาที</div>
            )}
          </div>
        )}
      </div>

      <LiveTabs />

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
              <Link to="/system-settings" className="inline-flex items-center gap-1.5 mt-3 text-sm font-medium text-blue-700 hover:underline">
                <SettingsIcon className="w-4 h-4" /> ไปหน้าตั้งค่าระบบ → การเชื่อมต่อฐาน HOSxP (เฉพาะ ADMIN)
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
          <label className="block text-xs font-medium text-gray-500 mb-1">สิทธิการรักษา</label>
          <PttypePicker value={pttype} onChange={setPttype} enabled={!!ready} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">แผนก</label>
          <select value={deptFilter} onChange={e => setDeptFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white max-w-[14rem]">
            <option value="">ทุกแผนก</option>
            {deptOptions.map(([name, c]) => (
              <option key={name} value={name}>{name} ({c.total}{c.bad ? ` · มีปัญหา ${c.bad}` : ''})</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">ห้องตรวจ</label>
          <select value={roomFilter} onChange={e => setRoomFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white max-w-[14rem]">
            <option value="">ทุกห้องตรวจ</option>
            {roomOptions.map(([name, c]) => (
              <option key={name} value={name}>{name} ({c.total}{c.bad ? ` · มีปัญหา ${c.bad}` : ''})</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">แพทย์ผู้ตรวจ</label>
          <select value={doctorFilter} onChange={e => setDoctorFilter(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white max-w-[14rem]">
            <option value="">ทุกแพทย์</option>
            {doctorOptions.map(([name, c]) => (
              <option key={name} value={name}>{name === '(ไม่ระบุ)' ? '(ยังไม่ลงแพทย์)' : name} ({c.total}{c.bad ? ` · มีปัญหา ${c.bad}` : ''})</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">รีเฟรชอัตโนมัติ</label>
          <div className="flex items-center gap-2">
            <button type="button" role="switch" aria-checked={refresh.on}
              onClick={() => setRefresh(r => ({ ...r, on: !r.on }))}
              title={refresh.on ? 'ปิดรีเฟรชอัตโนมัติ' : 'เปิดรีเฟรชอัตโนมัติ'}
              className={clsx('relative inline-flex h-6 w-11 flex-shrink-0 rounded-full transition-colors',
                refresh.on ? 'bg-blue-600' : 'bg-gray-300')}>
              <span className={clsx('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
                refresh.on ? 'translate-x-[22px]' : 'translate-x-0.5')} />
            </button>
            <span className={clsx('text-sm w-7', refresh.on ? 'text-blue-700 font-medium' : 'text-gray-400')}>
              {refresh.on ? 'เปิด' : 'ปิด'}
            </span>
            <select value={refresh.ms} disabled={!refresh.on}
              onChange={e => setRefresh(r => ({ ...r, ms: Number(e.target.value) }))}
              className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white disabled:bg-gray-50 disabled:text-gray-400">
              {REFRESH_OPTIONS.map(o => <option key={o.value} value={o.value}>ทุก {o.label}</option>)}
            </select>
          </div>
        </div>
        <button
          type="button"
          onClick={toggleSound}
          title="เสียงเตือนเมื่อมี visit ใหม่ที่มีปัญหา"
          className={clsx('inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border',
            sound ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-500')}
        >
          {sound ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />} เสียงเตือน
        </button>
        <button
          onClick={() => { forceNextRef.current = true; liveQuery.refetch() }}
          disabled={!ready || liveQuery.isFetching}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          <RefreshCw className={clsx('w-4 h-4', liveQuery.isFetching && 'animate-spin')} /> ดึงข้อมูลตอนนี้
        </button>
        {refreshMs === 0 && (
          <span className="text-xs text-gray-400 flex items-center gap-1"><PauseCircle className="w-3.5 h-3.5" /> ปิดรีเฟรชอัตโนมัติ</span>
        )}
      </div>

      {/* ความพร้อมของฐาน HOSxP สำหรับกฎแต่ละข้อ */}
      {readinessQuery.data && (
        <details className="card px-4 py-2.5 text-sm" open={!readinessQuery.data.checks.every(c => c.ok)}>
          <summary className="cursor-pointer flex items-center gap-2 text-gray-700">
            <ShieldCheck className={clsx('w-4 h-4', readinessQuery.data.checks.every(c => c.ok) ? 'text-emerald-600' : 'text-amber-500')} />
            ความพร้อมของฐาน HOSxP ({readinessQuery.data.dialect}) —
            {readinessQuery.data.checks.filter(c => c.ok).length}/{readinessQuery.data.checks.length} กฎพร้อมใช้
          </summary>
          <ul className="mt-2 space-y-1 pl-6">
            {readinessQuery.data.checks.map(c => (
              <li key={c.rule} className="flex items-start gap-2 text-xs">
                {c.ok ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 mt-0.5" /> : <XCircle className="w-3.5 h-3.5 text-amber-500 mt-0.5" />}
                <span>
                  <b>{c.rule}</b>
                  {!c.ok && <span className="text-gray-500"> — ไม่พบ {c.missing.join(', ')} (กฎนี้จะถูกข้าม)</span>}
                </span>
              </li>
            ))}
          </ul>
          {(readinessQuery.data.no_select?.length ?? 0) > 0 && (
            <div className="mt-3 pl-6 text-xs space-y-1.5">
              <p className="text-rose-700 font-medium">
                user ฐานข้อมูลยังไม่มีสิทธิ์อ่านตาราง — ส่งคำสั่งนี้ให้ IT / ผู้ดูแลฐาน HOSxP รัน แล้วกด "ตรวจความพร้อมอีกครั้ง"
              </p>
              <pre className="bg-gray-900 text-gray-100 rounded-lg p-3 overflow-x-auto select-all">{
                readinessQuery.data.dialect === 'mysql'
                  ? readinessQuery.data.no_select!.map(t => `GRANT SELECT ON ${t} TO '${readinessQuery.data!.db_user}'@'%';`).join('\n')
                  : `GRANT SELECT ON ${readinessQuery.data.no_select!.join(', ')} TO ${readinessQuery.data.db_user};`
              }</pre>
            </div>
          )}
          <button type="button" onClick={() => readinessQuery.refetch()} disabled={readinessQuery.isFetching}
            className="mt-2 ml-6 text-xs text-blue-700 hover:underline disabled:opacity-50">
            {readinessQuery.isFetching ? 'กำลังตรวจ...' : 'ตรวจความพร้อมอีกครั้ง'}
          </button>
        </details>
      )}

      {data && newVns.size > 0 && (
        <div className={clsx('text-sm rounded-lg px-4 py-2 flex items-center gap-2 border',
          newProblem ? 'bg-rose-50 border-rose-200 text-rose-700' : 'bg-blue-50 border-blue-100 text-blue-700')}>
          <Sparkles className="w-4 h-4" />
          มี visit ใหม่ {newVns.size} รายการตั้งแต่รอบก่อน{newProblem ? ` — มีปัญหา ${newProblem} รายการ (อยู่บนสุดของตาราง)` : ''}
        </div>
      )}

      {data && (data.rules_skipped?.length ?? 0) > 0 && (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          กฎจากเมนูแก้ไฟล์ที่ตรวจกับ HOSxP นี้ไม่ได้ (โครงสร้างตารางต่างจากมาตรฐาน): {data.rules_skipped!.join(' · ')}
        </div>
      )}

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

      {data && issueSummary.codes.length > 0 && (
        <div className="card">
          <button type="button" onClick={() => setShowSummary(v => !v)}
            className="w-full flex items-center gap-2 px-4 py-3 text-sm font-semibold text-gray-800">
            <BarChart3 className="w-4 h-4 text-blue-600" /> สรุปปัญหาตามรหัส / แผนก
            <span className="font-normal text-gray-400">— คลิกรายการเพื่อกรองตาราง</span>
            {showSummary ? <ChevronDown className="w-4 h-4 ml-auto text-gray-400" /> : <ChevronRight className="w-4 h-4 ml-auto text-gray-400" />}
          </button>
          {showSummary && (
            <div className="grid lg:grid-cols-2 gap-4 px-4 pb-4">
              <div className="border rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-gray-50 border-b text-xs font-semibold text-gray-600">ตามรหัสปัญหา</div>
                <div className="max-h-80 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-gray-500 sticky top-0 bg-white">
                      <tr><th className="px-3 py-1.5 text-left">รหัส</th><th className="px-3 py-1.5 text-left">เรื่อง</th>
                        <th className="px-3 py-1.5 text-right">visit</th><th className="px-3 py-1.5 text-right">ปัญหา</th></tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {issueSummary.codes.map(([code, c]) => (
                        <tr key={code} onClick={() => setCodeFilter(f => (f === code ? '' : code))}
                          className={clsx('cursor-pointer hover:bg-blue-50', codeFilter === code && 'bg-blue-100')}>
                          <td className="px-3 py-1.5 whitespace-nowrap">
                            <span className={clsx('inline-block w-2 h-2 rounded-full mr-2',
                              c.sev === 'ERROR' ? 'bg-rose-500' : c.sev === 'WARNING' ? 'bg-amber-400' : 'bg-sky-400')} />
                            <span className="font-mono text-xs">{code}</span>
                          </td>
                          <td className="px-3 py-1.5 text-gray-700">
                            {CODE_TITLES[code] || (c.example.length > 70 ? c.example.slice(0, 70) + '…' : c.example)}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums font-semibold">{c.vns.size.toLocaleString()}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-gray-500">{c.issues.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="border rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-gray-50 border-b text-xs font-semibold text-gray-600">ตามแผนก</div>
                <div className="max-h-80 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-gray-500 sticky top-0 bg-white">
                      <tr><th className="px-3 py-1.5 text-left">แผนก</th><th className="px-3 py-1.5 text-right">visit</th>
                        <th className="px-3 py-1.5 text-right">ไม่ผ่าน</th><th className="px-3 py-1.5 text-right">ผิด/เตือน</th>
                        <th className="px-3 py-1.5 text-left">รหัสที่พบบ่อย</th></tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {issueSummary.depts.map(([name, d]) => (
                        <tr key={name} onClick={() => setDeptFilter(f => (f === name ? '' : name))}
                          className={clsx('cursor-pointer hover:bg-blue-50', deptFilter === name && 'bg-blue-100')}>
                          <td className="px-3 py-1.5 text-gray-800">{name}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-gray-500">{d.total}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-rose-600">{d.bad || ''}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums text-xs whitespace-nowrap">
                            <span className="text-rose-600">{d.err}</span> / <span className="text-amber-600">{d.warn}</span>
                          </td>
                          <td className="px-3 py-1.5 text-xs text-gray-500 font-mono">
                            {[...d.codes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([c, n]) => `${c}×${n}`).join(' ')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ตาราง — เลื่อนซ้ายขวาได้ หัวตารางและ VN ติดอยู่กับที่ */}
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 border-b bg-white">
          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <span>คลิกแถวเพื่อดูปัญหา · ตารางกว้างเลื่อนซ้ายขวาได้</span>
            {codeFilter && (
              <button type="button" onClick={() => setCodeFilter('')}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">
                รหัส {codeFilter} <X className="w-3 h-3" />
              </button>
            )}
            {deptFilter && (
              <button type="button" onClick={() => setDeptFilter('')}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">
                {deptFilter} <X className="w-3 h-3" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={doExport} disabled={!rows.length || exporting}
              title="ส่งออกเฉพาะ visit ตามตัวกรองที่เลือกอยู่"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-emerald-300 rounded-lg text-sm text-emerald-700 bg-white hover:bg-emerald-50 disabled:opacity-50">
              <Download className={clsx('w-4 h-4', exporting && 'animate-bounce')} />
              ส่งออก Excel ({rows.length.toLocaleString()})
            </button>
            <ColumnPicker prefs={cols} />
          </div>
        </div>
        <div className="overflow-auto max-h-[70vh]">
          <table className="w-full text-sm min-w-max">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide border-b sticky top-0 z-10">
              <tr>
                <th className="px-3 py-3 w-8 bg-gray-50"></th>
                <th className="px-3 py-3 text-left bg-gray-50 sticky left-0 z-20">VN</th>
                {cols.show('hn') && <th className="px-3 py-3 text-left">HN</th>}
                {cols.show('name') && <th className="px-3 py-3 text-left">ชื่อผู้ป่วย</th>}
                {cols.show('date') && <th className="px-3 py-3 text-left">วันที่</th>}
                {cols.show('pttype') && <th className="px-3 py-3 text-left">สิทธิ</th>}
                {cols.show('dept') && <th className="px-3 py-3 text-left">แผนก / ห้องตรวจ</th>}
                {cols.show('doctor') && <th className="px-3 py-3 text-left">แพทย์ผู้ตรวจ</th>}
                {cols.show('pdx') && <th className="px-3 py-3 text-left">PDX</th>}
                {cols.show('charge') && <th className="px-3 py-3 text-right">ค่าใช้จ่าย</th>}
                <th className="px-3 py-3 text-left">สถานะ</th>
                {cols.show('issues') && <th className="px-3 py-3 text-left">ปัญหา</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {pager.slice.map((r) => (
                <LiveRow key={r.vn} r={r} isNew={newVns.has(r.vn)} expanded={expanded === r.vn}
                  onToggle={toggleRow} show={cols.show} colCount={cols.visibleCount + 1} />
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={cols.visibleCount + 1} className="px-4 py-12 text-center text-gray-400">
                    {liveQuery.isFetching ? 'กำลังดึงข้อมูลจาก HOSxP...' :
                     !ready ? 'รอการเชื่อมต่อฐาน HOSxP' : 'ไม่พบ visit ในช่วงเวลา/เงื่อนไขที่เลือก'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination p={pager} />
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

// memo: แถวที่ข้อมูลไม่เปลี่ยนไม่ต้อง render ใหม่ทุกรอบรีเฟรช/นาฬิกา
const LiveRow = memo(function LiveRow({ r, isNew, expanded, onToggle, show, colCount }: {
  r: LivePrescreenRecord; isNew: boolean; expanded: boolean; onToggle: (vn: string) => void
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
  const rowBg = isNew ? 'bg-blue-50' : r.status !== 'PASSED' ? 'bg-rose-50' : 'bg-white'

  return (
    <>
      <tr onClick={() => onToggle(r.vn)} className={clsx('cursor-pointer hover:bg-blue-50/40',
        isNew ? 'bg-blue-50/60' : r.status !== 'PASSED' && 'bg-rose-50/20')}>
        <td className="px-3 py-2.5 text-gray-400">
          {r.errors.length > 0 ? (expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />) : null}
        </td>
        <td className={clsx('px-3 py-2.5 font-mono text-gray-600 sticky left-0 whitespace-nowrap', rowBg)}>
          {r.vn}
          {isNew && <span className="ml-1.5 text-[11px] font-sans font-semibold bg-blue-600 text-white rounded px-1.5 py-0.5">ใหม่</span>}
        </td>
        {show('hn') && <td className="px-3 py-2.5 font-mono text-blue-800">{r.hn || '-'}</td>}
        {show('name') && <td className="px-3 py-2.5 text-gray-800 whitespace-nowrap">{r.patient_name || '-'}</td>}
        {show('date') && <td className="px-3 py-2.5 text-gray-500 whitespace-nowrap">{r.visit_date} {r.visit_time?.slice(0, 5)}</td>}
        {show('pttype') && (
          <td className="px-3 py-2.5 text-xs leading-tight">
            <div className="font-mono text-gray-500">{r.pttype}</div>
            {r.pttype_name && <div className="text-gray-800 whitespace-nowrap">{r.pttype_name}</div>}
          </td>
        )}
        {show('dept') && (
          <td className="px-3 py-2.5 text-xs leading-tight whitespace-nowrap">
            <div className="text-gray-800">{r.spclty_name || '-'}</div>
            <div className="text-gray-500">{r.main_dep_name}</div>
            {r.cur_dep_name && r.cur_dep_name !== r.main_dep_name && (
              <div className="text-blue-600" title="ห้องที่ผู้ป่วยอยู่ตอนนี้">ตอนนี้: {r.cur_dep_name}</div>
            )}
          </td>
        )}
        {show('doctor') && (
          <td className="px-3 py-2.5 text-xs text-gray-800 whitespace-nowrap">
            {r.doctor_name || <span className="text-gray-400">ยังไม่ลงแพทย์</span>}
          </td>
        )}
        {show('pdx') && <td className="px-3 py-2.5 font-mono">{r.pdx || <span className="text-rose-500 font-bold">ไม่มี</span>}</td>}
        {show('charge') && <td className="px-3 py-2.5 text-right font-mono">{r.total_charge.toLocaleString()}</td>}
        <td className="px-3 py-2.5">
          <span className={clsx('inline-block px-2 py-0.5 rounded-full text-xs font-semibold border whitespace-nowrap', badge)}>{label}</span>
        </td>
        {show('issues') && (
          <td className="px-3 py-2.5 text-xs whitespace-nowrap">
            {errCount > 0 && <span className="text-rose-600 font-semibold mr-2">{errCount} ข้อผิดพลาด</span>}
            {warnCount > 0 && <span className="text-amber-600">{warnCount} เตือน</span>}
            {r.errors.length === 0 && <span className="text-gray-300">—</span>}
          </td>
        )}
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
