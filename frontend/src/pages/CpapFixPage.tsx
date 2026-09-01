import { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  Upload, FileText, Trash2, CheckCircle2, AlertTriangle, Wand2, Download, ShieldCheck, ShieldAlert,
  History, RotateCcw, CalendarRange,
} from 'lucide-react'
import clsx from 'clsx'
import {
  analyzeCpapFiles, applyCpapFix,
  getCpapSessions, getCpapFiscalYears, downloadCpapSession, deleteCpapSession,
  clearCpapSessionsByFiscalYear,
} from '../lib/api'
import type { CpapAnalyzeResult, CpapFixSession } from '../types/cpapFix'

export default function CpapFixPage() {
  const qc = useQueryClient()
  const [files, setFiles] = useState<File[]>([])
  const [analysis, setAnalysis] = useState<CpapAnalyzeResult | null>(null)
  const [authCodes, setAuthCodes] = useState<Record<string, string>>({})
  const [noAuth, setNoAuth] = useState<Record<string, boolean>>({})   // visit ที่เลือก "ไม่ใส่เลขกำกับ"
  const [filterFY, setFilterFY] = useState<number | null>(null)
  const [activeTab, setActiveTab] = useState<'ALL' | 'CPAP' | 'PSG'>('ALL')

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
      data.cpap_visits.forEach(v => { init[v.visit_no] = v.current.svpid || '' })
      setAuthCodes(init)
      setNoAuth({})
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
        const code = (authCodes[v.visit_no] || '').trim()
        if (!noAuth[v.visit_no] && code) codes[v.visit_no] = code
      })
      return applyCpapFix(files, codes, shownVisits.map(v => v.visit_no))
    },
    onSuccess: ({ changes }) => {
      toast.success('แก้ไฟล์สำเร็จ — ดาวน์โหลด cpap_fixed.zip + บันทึกประวัติแล้ว')
      if (changes.length) toast(changes.join('\n'), { duration: 6000 })
      qc.invalidateQueries({ queryKey: ['cpap-sessions'] })
      qc.invalidateQueries({ queryKey: ['cpap-fiscal-years'] })
    },
    onError: (err: any) => toast.error(err.response?.data?.detail || 'แก้ไฟล์ไม่สำเร็จ'),
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

  const removeFile = (name: string) => {
    setFiles(prev => prev.filter(f => f.name !== name))
    setAnalysis(null)
  }

  const missingAuth = shownVisits.some(v => !noAuth[v.visit_no] && !(authCodes[v.visit_no] || '').trim())

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
            {shownVisits.length > 0 && (
              <label className="ml-auto flex items-center gap-1.5 text-xs font-normal text-gray-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={shownVisits.length > 0 && shownVisits.every(v => noAuth[v.visit_no])}
                  onChange={e => {
                    const checked = e.target.checked
                    setNoAuth(prev => {
                      const next = { ...prev }
                      shownVisits.forEach(v => { next[v.visit_no] = checked })
                      return next
                    })
                  }}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                ไม่ใส่เลขกำกับทั้งหมด
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
              {shownVisits.map(v => {
                const isCpap = v.claim_type === 'CPAP'
                const mainItem = v.items.find(i => i.claim_type === v.claim_type) || v.items.find(i => i.is_cpap)
                return (
                  <div key={v.visit_no} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="text-sm flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-gray-800">Inv {v.invno || v.visit_no}</span>
                        {v.vn && <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">VN {v.vn}</span>}
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
                          เลขกำกับการเบิก (SvPID) {noAuth[v.visit_no] ? '' : '*'}
                        </label>
                        <input
                          type="text"
                          value={noAuth[v.visit_no] ? '' : (authCodes[v.visit_no] ?? '')}
                          onChange={e => setAuthCodes(prev => ({ ...prev, [v.visit_no]: e.target.value.trim() }))}
                          placeholder={noAuth[v.visit_no] ? '— ไม่ใส่เลขกำกับ —' : (isCpap ? 'เช่น B4GFQJ' : 'เช่น L27P4S')}
                          disabled={!!noAuth[v.visit_no]}
                          className={clsx(
                            'w-full border rounded-lg px-3 py-1.5 text-sm uppercase outline-none',
                            noAuth[v.visit_no]
                              ? 'border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed'
                              : 'border-gray-300 focus:ring-2 focus:ring-blue-500'
                          )}
                        />
                        <label className="flex items-center gap-1.5 mt-1.5 text-xs text-gray-600 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={!!noAuth[v.visit_no]}
                            onChange={e => setNoAuth(prev => ({ ...prev, [v.visit_no]: e.target.checked }))}
                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          ไม่ใส่เลขกำกับ (กรณีไม่ต้องใช้)
                        </label>
                      </div>
                    </div>
                  </div>
                )
              })}

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => applyMutation.mutate()}
                  disabled={applyMutation.isPending || missingAuth}
                  className="inline-flex items-center gap-2 px-6 py-2.5 bg-green-600 text-white text-sm font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {applyMutation.isPending
                    ? <>กำลังแก้...</>
                    : <><Wand2 className="w-4 h-4" />แก้ไฟล์ + ดาวน์โหลด .zip</>}
                </button>
                {missingAuth && <span className="text-xs text-red-500">กรุณากรอกรหัสอนุมัติทุก visit ก่อน</span>}
                <span className="inline-flex items-center gap-1 text-xs text-gray-400"><Download className="w-3.5 h-3.5" />ไฟล์ผลลัพธ์คำนวณ Checksum ใหม่ให้อัตโนมัติ</span>
              </div>
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
  session: s, onDownload, onDelete,
}: {
  session: CpapFixSession
  onDownload: () => void
  onDelete: () => void
}) {
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
