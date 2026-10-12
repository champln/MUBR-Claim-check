import { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  Upload, FileText, Trash2, CheckCircle2, AlertTriangle, Wand2, Download, ShieldCheck, ShieldAlert,
  History, RotateCcw, CalendarRange, ClipboardPaste, RefreshCw,
} from 'lucide-react'
import clsx from 'clsx'
import {
  analyzeCpapFiles, applyCpapFix,
  getCpapSessions, getCpapFiscalYears, downloadCpapSession, deleteCpapSession,
  clearCpapSessionsByFiscalYear, refixCpapSession,
} from '../lib/api'
import type { CpapAnalyzeResult, CpapFixSession, CpapProblem, CpapVisit } from '../types/cpapFix'

// เลขกำกับการเบิกจากเว็บ สกส. — ต้องเป็นตัวพิมพ์ใหญ่ทั้งหมด (ตัวเล็กทำให้ติด C P02)
const AUTH_RE = /^[A-Z0-9]{4,20}$/
const normAuth = (s: string) => s.replace(/\s+/g, '').toUpperCase()
// HN ในไฟล์มักเติม 0 ข้างหน้า แต่ใน Excel อาจไม่มี -> เทียบแบบตัด 0 นำหน้า
const normKey = (s: string) => s.trim().replace(/^0+(?=\d)/, '')

/**
 * อ่านข้อความที่วางจาก Excel: แต่ละบรรทัดมี HN / Inv / VN อย่างใดอย่างหนึ่ง + เลขกำกับ
 * คืน {visit_no: เลขกำกับ} และบรรทัดที่จับคู่ไม่ได้
 */
function parsePasted(text: string, visits: CpapVisit[]) {
  const byKey = new Map<string, string>()
  visits.forEach(v => {
    [v.visit_no, v.invno, v.vn, v.hn].forEach(k => { if (k) byKey.set(normKey(k), v.visit_no) })
  })
  const matched: Record<string, string> = {}
  const unmatched: string[] = []
  text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).forEach(line => {
    const tokens = line.split(/[\t,;|]+|\s{2,}|\s+/).map(t => t.trim()).filter(Boolean)
    const visit = tokens.map(t => byKey.get(normKey(t))).find(Boolean)
    const code = [...tokens].reverse()
      .map(normAuth)
      .find(t => AUTH_RE.test(t) && /[A-Z]/.test(t) && !byKey.has(normKey(t)))
    if (visit && code) matched[visit] = code
    else unmatched.push(line)
  })
  return { matched, unmatched }
}

export default function CpapFixPage() {
  const qc = useQueryClient()
  const [files, setFiles] = useState<File[]>([])
  const [analysis, setAnalysis] = useState<CpapAnalyzeResult | null>(null)
  const [authCodes, setAuthCodes] = useState<Record<string, string>>({})
  const [noAuth, setNoAuth] = useState<Record<string, boolean>>({})   // visit ที่เลือก "ไม่ใส่เลขกำกับ"
  const [filterFY, setFilterFY] = useState<number | null>(null)
  const [activeTab, setActiveTab] = useState<'ALL' | 'CPAP' | 'PSG'>('ALL')
  const [pasteText, setPasteText] = useState('')
  const [pasteResult, setPasteResult] = useState<{ ok: number; unmatched: string[] } | null>(null)
  const [afterProblems, setAfterProblems] = useState<CpapProblem[] | null>(null)

  const onDrop = useCallback((accepted: File[]) => {
    setFiles(prev => {
      const names = new Set(prev.map(f => f.name))
      return [...prev, ...accepted.filter(f => !names.has(f.name))]
    })
    setAnalysis(null)
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/plain': ['.txt'],
      'application/zip': ['.zip'],
      'application/x-zip-compressed': ['.zip'],
    },
    maxFiles: 30,
    multiple: true,
  })

  const analyzeMutation = useMutation({
    mutationFn: () => analyzeCpapFiles(files),
    onSuccess: (data) => {
      setAnalysis(data)
      const init: Record<string, string> = {}
      const initNoAuth: Record<string, boolean> = {}
      data.cpap_visits.forEach(v => {
        init[v.visit_no] = normAuth(v.current.svpid || '')
        // PSG ไม่ต้องใช้เลขกำกับแล้ว (สกส. ก.ค. 69) — ถ้าไฟล์ไม่มีอยู่แล้วก็ไม่ต้องใส่
        if (v.claim_type === 'PSG' && !v.current.svpid) initNoAuth[v.visit_no] = true
      })
      setAuthCodes(init)
      setNoAuth(initNoAuth)
      setAfterProblems(null)
      setPasteResult(null)
      if (data.cpap_visits.length === 0) {
        toast('ไม่พบเคส CPAP หรือ Polysomnogram ในไฟล์นี้', { icon: 'ℹ️' })
      } else {
        const nCpap = data.cpap_visits.filter(v => v.claim_type === 'CPAP').length
        const nPsg = data.cpap_visits.filter(v => v.claim_type === 'PSG').length
        const parts = [nCpap ? `CPAP ${nCpap}` : '', nPsg ? `Polysomnogram ${nPsg}` : ''].filter(Boolean)
        toast.success(`พบ ${data.cpap_visits.length} visit (${parts.join(' · ')})`)
      }
    },
    onError: (err: any) => toast.error(err.response?.data?.detail || 'วิเคราะห์ไม่สำเร็จ'),
  })

  const shownVisits = (analysis?.cpap_visits ?? []).filter(
    v => activeTab === 'ALL' || v.claim_type === activeTab
  )

  const applyMutation = useMutation({
    mutationFn: () => {
      // ส่งเลขกำกับเฉพาะ visit ที่ไม่ได้เลือก "ไม่ใส่เลขกำกับ"
      const codes: Record<string, string> = {}
      shownVisits.forEach(v => {
        const code = normAuth(authCodes[v.visit_no] || '')
        if (!noAuth[v.visit_no] && code) codes[v.visit_no] = code
      })
      return applyCpapFix(files, codes, shownVisits.map(v => v.visit_no))
    },
    onSuccess: ({ changes, problems }) => {
      setAfterProblems(problems)
      if (problems.length) toast.error(`แก้แล้วแต่ยังเหลือ ${problems.length} จุดที่อาจติด C — ดูรายละเอียดด้านล่าง`)
      else toast.success('แก้ไฟล์สำเร็จ ตรวจซ้ำผ่านครบ — ดาวน์โหลด + บันทึกประวัติแล้ว')
      if (changes.length) toast(changes.join('\n'), { duration: 6000 })
      qc.invalidateQueries({ queryKey: ['cpap-sessions'] })
      qc.invalidateQueries({ queryKey: ['cpap-fiscal-years'] })
    },
    onError: async (err: any) => {
      // คำตอบเป็น blob — อ่านข้อความ error ออกมาแสดง
      let msg = 'แก้ไฟล์ไม่สำเร็จ'
      try { msg = JSON.parse(await err.response.data.text()).detail || msg } catch { /* ignore */ }
      toast.error(msg)
    },
  })

  const { data: sessions = [] } = useQuery({
    queryKey: ['cpap-sessions', filterFY, activeTab],
    queryFn: () => getCpapSessions(filterFY, activeTab === 'ALL' ? null : activeTab),
  })
  const { data: fiscalYears = [] } = useQuery({
    queryKey: ['cpap-fiscal-years'],
    queryFn: getCpapFiscalYears,
  })

  const deleteMutation = useMutation({
    mutationFn: deleteCpapSession,
    onSuccess: () => {
      toast.success('ลบประวัติแล้ว')
      qc.invalidateQueries({ queryKey: ['cpap-sessions'] })
      qc.invalidateQueries({ queryKey: ['cpap-fiscal-years'] })
    },
  })

  const clearMutation = useMutation({
    mutationFn: clearCpapSessionsByFiscalYear,
    onSuccess: (res: any) => {
      toast.success(res?.message || 'เคลียร์ปีงบเรียบร้อย')
      setFilterFY(null)
      qc.invalidateQueries({ queryKey: ['cpap-sessions'] })
      qc.invalidateQueries({ queryKey: ['cpap-fiscal-years'] })
    },
  })

  const refixMutation = useMutation({
    // แก้ทีละรายการตามลำดับ (เบราว์เซอร์มักบล็อกการดาวน์โหลดพร้อมกันหลายไฟล์)
    mutationFn: async (ids: number[]) => {
      const done: string[] = []
      for (const id of ids) done.push((await refixCpapSession(id)).filename)
      return done
    },
    onSuccess: (names) => {
      toast.success(`แก้ซ้ำแล้ว ${names.length} ไฟล์ — ดาวน์โหลด + บันทึกเป็นประวัติใหม่`)
      qc.invalidateQueries({ queryKey: ['cpap-sessions'] })
      qc.invalidateQueries({ queryKey: ['cpap-fiscal-years'] })
    },
    onError: async (err: any) => {
      let msg = 'แก้ซ้ำไม่สำเร็จ'
      try { msg = JSON.parse(await err.response.data.text()).detail || msg } catch { /* ignore */ }
      toast.error(msg, { duration: 8000 })
      qc.invalidateQueries({ queryKey: ['cpap-sessions'] })
    },
  })

  // รายการในประวัติที่ไฟล์ยังไม่ผ่านกฎปัจจุบัน และยังไม่มีรุ่นใหม่ที่ผ่านแล้ว
  const pendingRefix = sessions.filter(s => (s.problem_count ?? 0) > 0 && !s.superseded_by)

  const removeFile = (name: string) => {
    setFiles(prev => prev.filter(f => f.name !== name))
    setAnalysis(null)
  }

  // CPAP ต้องมีเลขกำกับเสมอ; PSG กรอกหรือไม่ก็ได้
  const needsAuth = (v: CpapVisit) => v.claim_type === 'CPAP' || !noAuth[v.visit_no]
  const missingAuth = shownVisits.some(v => needsAuth(v) && !normAuth(authCodes[v.visit_no] || ''))
  const invalidAuth = shownVisits.some(v => {
    const c = normAuth(authCodes[v.visit_no] || '')
    return needsAuth(v) && c !== '' && !AUTH_RE.test(c)
  })
  const psgShown = shownVisits.filter(v => v.claim_type === 'PSG')

  const applyPaste = () => {
    const { matched, unmatched } = parsePasted(pasteText, analysis?.cpap_visits ?? [])
    setAuthCodes(prev => ({ ...prev, ...matched }))
    setNoAuth(prev => {
      const next = { ...prev }
      Object.keys(matched).forEach(k => { next[k] = false })
      return next
    })
    setPasteResult({ ok: Object.keys(matched).length, unmatched })
  }

  const TABS: { key: 'ALL' | 'CPAP' | 'PSG'; label: string }[] = [
    { key: 'ALL', label: 'ทั้งหมด' },
    { key: 'CPAP', label: 'เครื่อง CPAP' },
    { key: 'PSG', label: 'Polysomnogram' },
  ]

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">แก้ไฟล์เบิก CPAP / Polysomnogram</h1>
        <p className="text-sm text-gray-500 mt-1">
          กรมบัญชีกลาง (สกส.) — สิทธิ์ข้าราชการ CSOP · ใส่ STCPAP / Class=ED / รหัสอนุมัติ แล้วคำนวณ Checksum ใหม่ ส่งได้ทันที
        </p>
      </div>

      {/* Tabs — กรองมุมมอง (ยัง auto-detect เหมือนเดิม) */}
      <div className="flex gap-1 border-b border-gray-200">
        {TABS.map(t => {
          const count = t.key === 'ALL'
            ? (analysis?.cpap_visits.length ?? 0)
            : (analysis?.cpap_visits.filter(v => v.claim_type === t.key).length ?? 0)
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActiveTab(t.key)}
              className={clsx(
                'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                activeTab === t.key
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              )}
            >
              {t.label}
              {analysis && t.key !== 'ALL' && count > 0 && (
                <span className="ml-1.5 text-xs bg-gray-100 text-gray-600 rounded-full px-1.5">{count}</span>
              )}
            </button>
          )
        })}
      </div>

      {/* Step 1: upload */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-5">
        <h2 className="font-semibold text-gray-800 flex items-center gap-2">
          <span className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center">1</span>
          อัปโหลดชุดไฟล์ส่งเบิก (BILLTRAN / OPServices / BILLDISP หรือ .zip)
        </h2>

        <div
          {...getRootProps()}
          className={clsx(
            'border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors',
            isDragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'
          )}
        >
          <input {...getInputProps()} />
          <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
          <p className="text-sm text-gray-600 font-medium">
            {isDragActive ? 'วางไฟล์ที่นี่...' : 'ลากวางไฟล์ หรือคลิกเพื่อเลือก'}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            BILLTRAN20xxxx.txt, OPServices20xxxx.txt, BILLDISP20xxxx.txt หรือไฟล์ .zip ของ session
          </p>
        </div>

        {files.length > 0 && (
          <ul className="space-y-1.5">
            {files.map(f => {
              const status = analysis?.files.find(x => x.name === f.name)
              return (
                <li key={f.name} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 text-sm">
                  <span className="flex items-center gap-2 text-gray-700 truncate">
                    <FileText className="w-4 h-4 text-blue-500 shrink-0" />
                    {f.name}
                    <span className="text-gray-400 text-xs">({(f.size / 1024).toFixed(1)} KB)</span>
                    {status && (status.checksum_valid
                      ? <span className="inline-flex items-center gap-1 text-green-600 text-xs"><ShieldCheck className="w-3.5 h-3.5" />checksum ถูกต้อง</span>
                      : status.checksum_valid === false
                        ? <span className="inline-flex items-center gap-1 text-red-600 text-xs"><ShieldAlert className="w-3.5 h-3.5" />checksum ไม่ตรง</span>
                        : null)}
                  </span>
                  <button type="button" onClick={() => removeFile(f.name)} className="text-gray-400 hover:text-red-500 ml-2 shrink-0">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        <button
          type="button"
          onClick={() => analyzeMutation.mutate()}
          disabled={analyzeMutation.isPending || !files.length}
          className="px-6 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {analyzeMutation.isPending ? 'กำลังวิเคราะห์...' : 'วิเคราะห์ไฟล์'}
        </button>
      </div>

      {/* Step 2: review + auth codes */}
      {analysis && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-5">
          <h2 className="font-semibold text-gray-800 flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center">2</span>
            ตรวจสอบ visit และกรอกเลขกำกับการเบิก (SvPID)
            {psgShown.length > 0 && (
              <label className="ml-auto flex items-center gap-1.5 text-xs font-normal text-gray-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={psgShown.every(v => noAuth[v.visit_no])}
                  onChange={e => {
                    const checked = e.target.checked
                    setNoAuth(prev => {
                      const next = { ...prev }
                      psgShown.forEach(v => { next[v.visit_no] = checked })
                      return next
                    })
                  }}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                PSG ทั้งหมดไม่ใส่เลขกำกับ
              </label>
            )}
          </h2>

          {analysis.cpap_visits.length === 0 ? (
            <p className="text-sm text-gray-500">ไม่พบเคส CPAP หรือ Polysomnogram — ไม่มีอะไรต้องแก้</p>
          ) : shownVisits.length === 0 ? (
            <p className="text-sm text-gray-500">
              ไม่มีเคส{activeTab === 'CPAP' ? ' เครื่อง CPAP' : ' Polysomnogram'} ในไฟล์นี้ — ลองสลับแท็บ "ทั้งหมด"
            </p>
          ) : (
            <div className="space-y-4">
              <div className="text-xs text-gray-600 bg-blue-50 border border-blue-100 rounded-lg p-3 space-y-1">
                <div><b>เครื่อง CPAP</b> — ต้องมีเลขกำกับการเบิกทุก visit · แพทย์ ว47988</div>
                <div><b>Polysomnogram</b> — ไม่ต้องใส่เลขกำกับแล้ว (สกส. แจ้ง ก.ค. 69) · ตรวจแค่ แพทย์ ว29312</div>
                <div className="text-rose-600">เลขกำกับต้องเป็น<b>ตัวพิมพ์ใหญ่ทั้งหมด</b> — ระบบแปลงให้อัตโนมัติ (ตัวเล็กทำให้ติด C P02)</div>
              </div>

              <details className="border border-gray-200 rounded-lg">
                <summary className="px-4 py-2.5 text-sm font-medium text-gray-700 cursor-pointer flex items-center gap-2">
                  <ClipboardPaste className="w-4 h-4 text-blue-600" /> วางเลขกำกับจาก Excel ทีเดียวหลาย visit
                </summary>
                <div className="px-4 pb-4 space-y-2">
                  <p className="text-xs text-gray-500">
                    คัดลอก 2 คอลัมน์จาก Excel (HN หรือ Inv หรือ VN + เลขกำกับ) มาวางได้เลย บรรทัดละ 1 visit
                  </p>
                  <textarea
                    value={pasteText}
                    onChange={e => { setPasteText(e.target.value); setPasteResult(null) }}
                    rows={5}
                    placeholder={'HN 1234\tAB12CD\nInv 100001\txy34ef'}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <div className="flex items-center gap-3 flex-wrap">
                    <button type="button" onClick={applyPaste} disabled={!pasteText.trim()}
                      className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50">
                      เติมเลขกำกับ
                    </button>
                    {pasteResult && (
                      <span className="text-xs text-gray-600">
                        จับคู่ได้ <b className="text-green-600">{pasteResult.ok}</b> visit
                        {pasteResult.unmatched.length > 0 && <> · ไม่พบใน visit ของไฟล์นี้ <b className="text-amber-600">{pasteResult.unmatched.length}</b> บรรทัด</>}
                      </span>
                    )}
                  </div>
                  {pasteResult && pasteResult.unmatched.length > 0 && (
                    <ul className="text-xs font-mono text-amber-700 space-y-0.5">
                      {pasteResult.unmatched.slice(0, 8).map((l, i) => <li key={i}>{l}</li>)}
                    </ul>
                  )}
                </div>
              </details>

              {shownVisits.map(v => {
                const isCpap = v.claim_type === 'CPAP'
                const mainItem = v.items.find(i => i.claim_type === v.claim_type) || v.items.find(i => i.is_cpap)
                return (
                  <div key={v.visit_no} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="text-sm flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-gray-800">Inv {v.invno || v.visit_no}</span>
                        {v.vn && <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">VN {v.vn}</span>}
                        {v.hn && <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">HN {v.hn}</span>}
                        <span className={clsx('text-xs px-2 py-0.5 rounded-full font-medium',
                          isCpap ? 'bg-indigo-100 text-indigo-700' : 'bg-teal-100 text-teal-700')}>
                          {isCpap ? 'เครื่อง CPAP' : 'Polysomnogram'}
                        </span>
                        {v.patient_name && <span className="text-gray-700 font-medium">{v.patient_name}</span>}
                        {mainItem && <span className="text-gray-400">· {mainItem.name}</span>}
                      </div>
                      {v.needs_fix
                        ? <span className="inline-flex items-center gap-1 text-yellow-600 text-xs"><AlertTriangle className="w-3.5 h-3.5" />ต้องแก้</span>
                        : <span className="inline-flex items-center gap-1 text-green-600 text-xs"><CheckCircle2 className="w-3.5 h-3.5" />ครบแล้ว</span>}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-3 text-sm">
                      {isCpap
                        ? <FieldDiff label="AuthCode (BILLTRAN)" current={v.current.authcode} target="STCPAP" />
                        : <div className="text-xs text-gray-400 self-center">BILLTRAN: ไม่แก้ (เคส PSG)</div>}
                      <FieldDiff label="Class (OPServices)" current={v.current.class} target="ED" />
                      <FieldDiff
                        label={`เลข ว แพทย์${v.doctor_name ? ` (${v.doctor_name})` : ''}`}
                        current={v.current.doctor}
                        target={v.doctor_target || ''}
                      />
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">
                          เลขกำกับการเบิก (SvPID) {isCpap ? '*' : '(ไม่บังคับ)'}
                        </label>
                        <input
                          type="text"
                          value={noAuth[v.visit_no] ? '' : (authCodes[v.visit_no] ?? '')}
                          onChange={e => setAuthCodes(prev => ({ ...prev, [v.visit_no]: normAuth(e.target.value) }))}
                          placeholder={noAuth[v.visit_no] ? '— ไม่ใส่เลขกำกับ —' : (isCpap ? 'เช่น AB12CD' : 'เช่น XY34EF')}
                          disabled={!!noAuth[v.visit_no]}
                          className={clsx(
                            'w-full border rounded-lg px-3 py-1.5 text-sm font-mono outline-none',
                            noAuth[v.visit_no]
                              ? 'border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed'
                              : (authCodes[v.visit_no] && !AUTH_RE.test(authCodes[v.visit_no]))
                                ? 'border-rose-400 bg-rose-50'
                                : 'border-gray-300 focus:ring-2 focus:ring-blue-500'
                          )}
                        />
                        {!noAuth[v.visit_no] && authCodes[v.visit_no] && !AUTH_RE.test(authCodes[v.visit_no]) && (
                          <div className="text-[12px] text-rose-600 mt-1">ต้องเป็นตัวอักษรอังกฤษ/ตัวเลข 4–20 ตัว</div>
                        )}
                        {!isCpap && (
                          <label className="flex items-center gap-1.5 mt-1.5 text-xs text-gray-600 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={!!noAuth[v.visit_no]}
                              onChange={e => setNoAuth(prev => ({ ...prev, [v.visit_no]: e.target.checked }))}
                              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            ไม่ใส่เลขกำกับ (PSG ไม่บังคับ)
                          </label>
                        )}
                      </div>
                    </div>

                    {(v.problems?.length ?? 0) > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {v.problems!.map((p, i) => (
                          <span key={i} className="text-[12px] bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5">
                            <b>{p.code}</b> {p.message}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => applyMutation.mutate()}
                  disabled={applyMutation.isPending || missingAuth || invalidAuth}
                  className="inline-flex items-center gap-2 px-6 py-2.5 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {applyMutation.isPending
                    ? <>กำลังแก้...</>
                    : <><Wand2 className="w-4 h-4" />แก้ไฟล์ + ดาวน์โหลด .zip</>}
                </button>
                {missingAuth && <span className="text-xs text-red-500">กรุณากรอกเลขกำกับของเคส CPAP ให้ครบ</span>}
                {invalidAuth && <span className="text-xs text-red-500">มีเลขกำกับที่รูปแบบไม่ถูกต้อง</span>}
                <span className="inline-flex items-center gap-1 text-xs text-gray-400"><Download className="w-3.5 h-3.5" />ไฟล์ผลลัพธ์คำนวณ Checksum ใหม่ให้อัตโนมัติ</span>
              </div>

              {afterProblems && (
                afterProblems.length === 0 ? (
                  <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-100 rounded-lg px-4 py-2.5">
                    <CheckCircle2 className="w-4 h-4" /> ตรวจไฟล์ที่แก้แล้วซ้ำ: ผ่านครบทุก visit (STCPAP · ED · เลข ว แพทย์ · เลขกำกับตัวพิมพ์ใหญ่)
                  </div>
                ) : (
                  <div className="text-sm text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-4 py-2.5 space-y-1">
                    <div className="font-medium flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> ไฟล์ที่แก้แล้วยังมีจุดที่อาจติด C</div>
                    {afterProblems.map((p, i) => (
                      <div key={i} className="text-xs">Inv {p.visit_no} · <b>{p.code}</b> {p.message}</div>
                    ))}
                  </div>
                )
              )}
            </div>
          )}
        </div>
      )}

      {/* History */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-3">
          <h2 className="font-semibold text-gray-800 flex items-center gap-2">
            <History className="w-5 h-5 text-blue-600" />
            ประวัติการแก้ไฟล์
          </h2>
          <div className="flex items-center gap-2">
            <CalendarRange className="w-4 h-4 text-gray-400" />
            <select
              value={filterFY ?? ''}
              onChange={e => setFilterFY(e.target.value ? Number(e.target.value) : null)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            >
              <option value="">ทุกปีงบประมาณ</option>
              {fiscalYears.map(fy => (
                <option key={String(fy.fiscal_year)} value={fy.fiscal_year ?? ''}>
                  ปีงบ {fy.fiscal_year ?? '—'} ({fy.count})
                </option>
              ))}
            </select>
            {filterFY != null && (
              <button
                type="button"
                onClick={() => {
                  if (confirm(`ลบประวัติทั้งหมดของปีงบ ${filterFY}? (ลบถาวร กู้คืนไม่ได้)`)) clearMutation.mutate(filterFY)
                }}
                disabled={clearMutation.isPending}
                className="inline-flex items-center gap-1 px-3 py-1.5 bg-red-50 text-red-600 text-sm font-medium rounded-lg hover:bg-red-100 disabled:opacity-50"
              >
                <Trash2 className="w-4 h-4" />เคลียร์ปีงบ {filterFY}
              </button>
            )}
          </div>
        </div>

        {pendingRefix.length > 0 && (
          <div className="px-6 py-3 bg-amber-50 border-b border-amber-100 flex items-center gap-3 flex-wrap text-sm">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            <span className="text-amber-800">
              มีไฟล์ในประวัติ <b>{pendingRefix.length}</b> รายการที่ไม่ผ่านกฎปัจจุบัน
              ({[...new Set(pendingRefix.flatMap(s => s.problem_codes ?? []))].join(', ')}) — ถ้าส่งไปแล้วอาจติด C
            </span>
            <button
              type="button"
              onClick={() => {
                if (confirm(`แก้ซ้ำ ${pendingRefix.length} ไฟล์? ระบบใช้เลขกำกับเดิมในไฟล์ และบันทึกเป็นประวัติใหม่ (ของเดิมยังอยู่)`))
                  refixMutation.mutate(pendingRefix.map(s => s.id))
              }}
              disabled={refixMutation.isPending}
              className="ml-auto inline-flex items-center gap-1 px-3 py-1.5 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 disabled:opacity-50"
            >
              <RefreshCw className={clsx('w-4 h-4', refixMutation.isPending && 'animate-spin')} />
              แก้ซ้ำทั้งหมด
            </button>
          </div>
        )}

        {sessions.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">
            {filterFY != null ? `ไม่มีประวัติในปีงบ ${filterFY}` : 'ยังไม่มีประวัติการแก้ไฟล์'}
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {sessions.map(s => (
              <HistoryRow
                key={s.id}
                session={s}
                onDownload={() => downloadCpapSession(s.id, s.result_filename || 'cpap_fixed.zip')}
                onRefix={() => refixMutation.mutate([s.id])}
                refixing={refixMutation.isPending}
                onDelete={() => { if (confirm('ลบประวัติรายการนี้?')) deleteMutation.mutate(s.id) }}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function HistoryRow({
  session: s, onDownload, onDelete, onRefix, refixing,
}: {
  session: CpapFixSession
  onDownload: () => void
  onDelete: () => void
  onRefix: () => void
  refixing: boolean
}) {
  const bad = (s.problem_count ?? 0) > 0
  const changes: string[] = s.changes ? safeParse(s.changes, []) : []
  const created = s.created_at ? new Date(s.created_at).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : ''
  return (
    <li className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-gray-800 text-sm truncate">{s.session_name}</span>
          {(s.claim_types || '').split(',').filter(Boolean).map(ct => (
            <span key={ct} className={clsx('text-xs px-2 py-0.5 rounded-full font-medium',
              ct === 'CPAP' ? 'bg-indigo-100 text-indigo-700' : 'bg-teal-100 text-teal-700')}>
              {ct === 'CPAP' ? 'CPAP' : 'PSG'}
            </span>
          ))}
          {s.fiscal_year != null && (
            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">ปีงบ {s.fiscal_year}</span>
          )}
          {s.pay_plan && <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{s.pay_plan}</span>}
          {!bad
            ? <span className="inline-flex items-center gap-1 text-xs text-green-600"><CheckCircle2 className="w-3.5 h-3.5" />ผ่านกฎปัจจุบัน</span>
            : s.superseded_by
              ? <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">รุ่นเก่า ({s.problem_codes?.join(', ')}) · แก้ใหม่แล้วที่ #{s.superseded_by}</span>
              : <span className="inline-flex items-center gap-1 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                  <AlertTriangle className="w-3.5 h-3.5" />ไม่ผ่าน {s.problem_codes?.join(', ')}
                </span>}
          <span className="text-xs text-gray-300">#{s.id}</span>
        </div>
        <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-500 flex-wrap">
          <span>{s.visit_count} visit</span>
          <span>{s.file_count} ไฟล์</span>
          {s.service_date && <span>บริการ {s.service_date}</span>}
          <span className="text-gray-400">{created}</span>
        </div>
        {changes.length > 0 && (
          <div className="mt-1 text-xs text-green-700 truncate">{changes.join(' · ')}</div>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {bad && !s.superseded_by && (
          <button
            onClick={onRefix}
            disabled={refixing}
            title="แก้ไฟล์นี้ซ้ำด้วยกฎปัจจุบัน (ใช้เลขกำกับเดิม) แล้วบันทึกเป็นประวัติใหม่"
            className="inline-flex items-center gap-1 px-3 py-1.5 bg-amber-50 text-amber-700 text-sm font-medium rounded-lg hover:bg-amber-100 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />แก้ซ้ำ
          </button>
        )}
        <button
          onClick={onDownload}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-blue-600 text-sm font-medium rounded-lg hover:bg-blue-50 transition-colors"
        >
          <RotateCcw className="w-4 h-4" />โหลดซ้ำ
        </button>
        <button
          onClick={onDelete}
          className="p-1.5 text-gray-400 hover:text-red-500 rounded hover:bg-red-50 transition-colors"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </li>
  )
}

function safeParse<T>(s: string, fallback: T): T {
  try { return JSON.parse(s) as T } catch { return fallback }
}

function FieldDiff({ label, current, target }: { label: string; current: string; target: string }) {
  const ok = current === target
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      <div className="flex items-center gap-2 text-sm">
        <span className={clsx('px-2 py-1 rounded font-mono text-xs', ok ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500')}>
          {current || '(ว่าง)'}
        </span>
        {!ok && (
          <>
            <span className="text-gray-400">→</span>
            <span className="px-2 py-1 rounded font-mono text-xs bg-blue-50 text-blue-700">{target}</span>
          </>
        )}
      </div>
    </div>
  )
}
