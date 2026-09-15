import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  ArrowLeft, AlertCircle, AlertTriangle, CheckCircle2,
  Download, Search, Pencil, Save, X, ChevronDown, ChevronUp, Info, Table2
} from 'lucide-react'
import clsx from 'clsx'
import {
  getClaimFileSession, getClaimFileRecords,
  editClaimFileRecord, exportClaimFileSummary
} from '../lib/api'
import type { ClaimFileRecord, ClaimIssue } from '../types/claimFile'
import { FUND_TYPE_LABELS } from '../types/claimFile'
import { MONTHS_TH } from '../types/claim'

export default function ClaimFileDetailPage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const id = Number(sessionId)

  const [search, setSearch] = useState('')
  const [filterError, setFilterError] = useState<boolean | undefined>(undefined)
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const { data: session } = useQuery({
    queryKey: ['claim-file-session', id],
    queryFn: () => getClaimFileSession(id),
  })

  const { data: records = [], isLoading } = useQuery({
    queryKey: ['claim-file-records', id, filterError, search],
    queryFn: () =>
      getClaimFileRecords(id, {
        limit: 500,
        has_error: filterError,
        search: search || undefined,
      }),
    enabled: !!id,
  })

  const editMutation = useMutation({
    mutationFn: ({ recordId, data }: { recordId: number; data: Record<string, unknown> }) =>
      editClaimFileRecord(id, recordId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['claim-file-records', id] })
      toast.success('บันทึกการแก้ไขเรียบร้อย')
    },
    onError: () => toast.error('ไม่สามารถบันทึกได้'),
  })

  const errorCount = records.filter(r => r.has_error).length
  const warnCount = records.filter(r => r.has_warning && !r.has_error).length
  const passCount = records.filter(r => !r.has_error && !r.has_warning).length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <button
            onClick={() => navigate('/claim-files')}
            className="mt-1 p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-gray-900">{session?.session_name ?? '...'}</h1>
            <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
              {session && (
                <>
                  <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs font-medium">
                    {FUND_TYPE_LABELS[session.fund_type]}
                  </span>
                  {session.period_month && session.period_year && (
                    <span>{MONTHS_TH[(session.period_month ?? 1) - 1]} {session.period_year}</span>
                  )}
                  <span>{session.total_records} records</span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate(`/claim-files/${id}/edit`)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors"
            title="แก้ไขได้ทุกฟิลด์ แล้วเซ็น Checksum (MD5) ใหม่"
          >
            <Table2 className="w-4 h-4" />
            แก้ไขไฟล์ + เซ็น MD5
          </button>
          <button
            onClick={() => session && exportClaimFileSummary(id, session.session_name)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <Download className="w-4 h-4" />
            Export JSON
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <SummaryCard
          label="ข้อผิดพลาด"
          count={errorCount}
          icon={<AlertCircle className="w-5 h-5" />}
          color="red"
          active={filterError === true}
          onClick={() => setFilterError(prev => prev === true ? undefined : true)}
        />
        <SummaryCard
          label="คำเตือน"
          count={warnCount}
          icon={<AlertTriangle className="w-5 h-5" />}
          color="yellow"
          active={filterError === false}
          onClick={() => setFilterError(prev => prev === false ? undefined : false)}
        />
        <SummaryCard
          label="ผ่านการตรวจสอบ"
          count={passCount}
          icon={<CheckCircle2 className="w-5 h-5" />}
          color="green"
          active={filterError === undefined && search === ''}
          onClick={() => { setFilterError(undefined); setSearch('') }}
        />
      </div>

      {/* Search + filter bar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="ค้นหา visit_no, CID, ชื่อผู้ป่วย..."
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
          />
        </div>
        {(filterError !== undefined || search) && (
          <button
            onClick={() => { setFilterError(undefined); setSearch('') }}
            className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
          >
            <X className="w-3.5 h-3.5" /> ล้างตัวกรอง
          </button>
        )}
      </div>

      {/* Records table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-10 text-center text-gray-400 text-sm">กำลังโหลด...</div>
        ) : records.length === 0 ? (
          <div className="p-10 text-center text-gray-400 text-sm">ไม่พบข้อมูล</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-xs text-gray-500 uppercase tracking-wide">
                  <th className="text-left px-4 py-3 w-8"></th>
                  <th className="text-left px-4 py-3">Visit No</th>
                  <th className="text-left px-4 py-3">CID / HN</th>
                  <th className="text-left px-4 py-3">ชื่อผู้ป่วย</th>
                  <th className="text-left px-4 py-3">วันที่</th>
                  <th className="text-left px-4 py-3">PDX</th>
                  <th className="text-right px-4 py-3">ค่าใช้จ่าย</th>
                  <th className="text-right px-4 py-3">Copay</th>
                  <th className="text-center px-4 py-3">สถานะ</th>
                  <th className="text-center px-4 py-3 w-20">แก้ไข</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {records.map(rec => (
                  <RecordRow
                    key={rec.id}
                    record={rec}
                    expanded={expandedId === rec.id}
                    onToggleExpand={() => setExpandedId(prev => prev === rec.id ? null : rec.id)}
                    onSave={(data) => editMutation.mutate({ recordId: rec.id, data })}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Summary card ─────────────────────────────────────────────────────────────

function SummaryCard({
  label, count, icon, color, active, onClick
}: {
  label: string
  count: number
  icon: React.ReactNode
  color: 'red' | 'yellow' | 'green'
  active: boolean
  onClick: () => void
}) {
  const colors = {
    red: 'text-red-600 bg-red-50 border-red-200',
    yellow: 'text-yellow-600 bg-yellow-50 border-yellow-200',
    green: 'text-green-600 bg-green-50 border-green-200',
  }
  return (
    <button
      onClick={onClick}
      className={clsx(
        'rounded-xl border p-4 text-left transition-all hover:shadow-sm',
        active ? colors[color] + ' ring-2 ring-offset-1' : 'bg-white border-gray-200',
        active ? '' : 'hover:bg-gray-50'
      )}
    >
      <div className={clsx('mb-2', active ? '' : color === 'red' ? 'text-red-500' : color === 'yellow' ? 'text-yellow-500' : 'text-green-500')}>
        {icon}
      </div>
      <p className="text-2xl font-bold text-gray-900">{count}</p>
      <p className="text-sm text-gray-500">{label}</p>
    </button>
  )
}

// ─── Record row ───────────────────────────────────────────────────────────────

function RecordRow({
  record: rec,
  expanded,
  onToggleExpand,
  onSave,
}: {
  record: ClaimFileRecord
  expanded: boolean
  onToggleExpand: () => void
  onSave: (data: Record<string, unknown>) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Record<string, string>>({})

  // Use edited_data if available, fallback to record fields
  const editedData: Record<string, unknown> = rec.edited_data ? JSON.parse(rec.edited_data) : {}
  const val = (field: string, fallback: string | null) =>
    String(editedData[field] ?? fallback ?? '')

  const issues: ClaimIssue[] = rec.issues ? JSON.parse(rec.issues) : []
  const errors = issues.filter(i => i.severity === 'ERROR')
  const warnings = issues.filter(i => i.severity === 'WARNING')

  const startEdit = () => {
    setDraft({
      cid: val('cid', rec.cid),
      patient_name: val('patient_name', rec.patient_name),
      visit_date: val('visit_date', rec.visit_date),
      pdx: val('pdx', rec.pdx),
      total_charge: String(val('total_charge', String(rec.total_charge))),
      claim_amount: String(val('claim_amount', String(rec.claim_amount))),
      copay: String(val('copay', String(rec.copay_amount))),
    })
    setEditing(true)
  }

  const cancelEdit = () => { setEditing(false); setDraft({}) }

  const saveEdit = () => {
    const data: Record<string, unknown> = {}
    Object.entries(draft).forEach(([k, v]) => {
      if (['total_charge', 'claim_amount', 'copay'].includes(k)) {
        data[k] = parseFloat(v) || 0
      } else {
        data[k] = v
      }
    })
    onSave(data)
    setEditing(false)
    setDraft({})
  }

  const statusBadge = rec.has_error
    ? <span className="inline-flex items-center gap-1 text-xs text-red-600 bg-red-50 px-2 py-0.5 rounded-full"><AlertCircle className="w-3 h-3" /> {errors.length} error</span>
    : rec.has_warning
    ? <span className="inline-flex items-center gap-1 text-xs text-yellow-600 bg-yellow-50 px-2 py-0.5 rounded-full"><AlertTriangle className="w-3 h-3" /> {warnings.length} warning</span>
    : <span className="inline-flex items-center gap-1 text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded-full"><CheckCircle2 className="w-3 h-3" /> ผ่าน</span>

  return (
    <>
      <tr className={clsx(
        'transition-colors',
        rec.has_error ? 'bg-red-50/40' : rec.has_warning ? 'bg-yellow-50/30' : '',
        rec.is_edited && 'ring-1 ring-inset ring-blue-300',
      )}>
        {/* Expand button */}
        <td className="px-4 py-3">
          {issues.length > 0 && (
            <button onClick={onToggleExpand} className="text-gray-400 hover:text-gray-600">
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          )}
        </td>

        {/* Visit No */}
        <td className="px-4 py-3 font-mono text-xs text-gray-700">
          {rec.visit_no || '-'}
          {rec.is_edited && <span className="ml-1 text-xs text-blue-500">(แก้ไขแล้ว)</span>}
        </td>

        {/* CID / HN */}
        <td className="px-4 py-3">
          {editing ? (
            <input
              value={draft.cid ?? ''}
              onChange={e => setDraft(d => ({ ...d, cid: e.target.value }))}
              className="w-36 border border-gray-300 rounded px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500 outline-none"
            />
          ) : (
            <span className="font-mono text-xs text-gray-700">
              {val('cid', rec.cid) || '-'}
              {rec.hn && <span className="block text-gray-400">{rec.hn}</span>}
            </span>
          )}
        </td>

        {/* Patient name */}
        <td className="px-4 py-3 text-gray-700">
          {editing ? (
            <input
              value={draft.patient_name ?? ''}
              onChange={e => setDraft(d => ({ ...d, patient_name: e.target.value }))}
              className="w-40 border border-gray-300 rounded px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500 outline-none"
            />
          ) : (
            <span className="text-sm">{val('patient_name', rec.patient_name) || '-'}</span>
          )}
        </td>

        {/* Date */}
        <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">
          {editing ? (
            <input
              value={draft.visit_date ?? ''}
              onChange={e => setDraft(d => ({ ...d, visit_date: e.target.value }))}
              className="w-32 border border-gray-300 rounded px-2 py-1 text-xs focus:ring-1 focus:ring-blue-500 outline-none"
            />
          ) : (
            <>
              {val('visit_date', rec.visit_date) || '-'}
              {rec.discharge_date && (
                <span className="block text-gray-400">→ {rec.discharge_date}</span>
              )}
            </>
          )}
        </td>

        {/* PDX */}
        <td className="px-4 py-3">
          {editing ? (
            <input
              value={draft.pdx ?? ''}
              onChange={e => setDraft(d => ({ ...d, pdx: e.target.value.toUpperCase() }))}
              className="w-24 border border-gray-300 rounded px-2 py-1 text-xs font-mono focus:ring-1 focus:ring-blue-500 outline-none"
            />
          ) : (
            <span className={clsx(
              'font-mono text-xs px-1.5 py-0.5 rounded',
              val('pdx', rec.pdx) ? 'bg-gray-100 text-gray-700' : 'text-red-400'
            )}>
              {val('pdx', rec.pdx) || 'ไม่มี'}
            </span>
          )}
        </td>

        {/* Total charge */}
        <td className="px-4 py-3 text-right text-sm text-gray-700">
          {editing ? (
            <input
              value={draft.total_charge ?? ''}
              onChange={e => setDraft(d => ({ ...d, total_charge: e.target.value }))}
              className="w-24 border border-gray-300 rounded px-2 py-1 text-xs text-right focus:ring-1 focus:ring-blue-500 outline-none"
            />
          ) : (
            Number(val('total_charge', String(rec.total_charge))).toLocaleString('th-TH', { minimumFractionDigits: 2 })
          )}
        </td>

        {/* Copay */}
        <td className="px-4 py-3 text-right text-sm text-gray-700">
          {editing ? (
            <input
              value={draft.copay ?? ''}
              onChange={e => setDraft(d => ({ ...d, copay: e.target.value }))}
              className="w-20 border border-gray-300 rounded px-2 py-1 text-xs text-right focus:ring-1 focus:ring-blue-500 outline-none"
            />
          ) : (
            Number(val('copay', String(rec.copay_amount))).toLocaleString('th-TH', { minimumFractionDigits: 2 })
          )}
        </td>

        {/* Status */}
        <td className="px-4 py-3 text-center">{statusBadge}</td>

        {/* Edit buttons */}
        <td className="px-4 py-3 text-center">
          {editing ? (
            <div className="flex items-center justify-center gap-1">
              <button
                onClick={saveEdit}
                className="p-1.5 text-green-600 hover:bg-green-50 rounded transition-colors"
                title="บันทึก"
              >
                <Save className="w-4 h-4" />
              </button>
              <button
                onClick={cancelEdit}
                className="p-1.5 text-gray-400 hover:bg-gray-100 rounded transition-colors"
                title="ยกเลิก"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={startEdit}
              className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
              title="แก้ไข"
            >
              <Pencil className="w-4 h-4" />
            </button>
          )}
        </td>
      </tr>

      {/* Expanded issues */}
      {expanded && issues.length > 0 && (
        <tr>
          <td colSpan={10} className="px-6 py-3 bg-gray-50 border-b border-gray-200">
            <div className="space-y-1.5">
              {issues.map((issue, i) => (
                <div
                  key={i}
                  className={clsx(
                    'flex items-start gap-2 text-xs rounded-lg px-3 py-2',
                    issue.severity === 'ERROR'
                      ? 'bg-red-50 text-red-700 border border-red-200'
                      : 'bg-yellow-50 text-yellow-700 border border-yellow-200'
                  )}
                >
                  {issue.severity === 'ERROR'
                    ? <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    : <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  }
                  <span>
                    <strong className="font-semibold">[{issue.code}]</strong>{' '}
                    {issue.field && <span className="opacity-70">{issue.field}: </span>}
                    {issue.message}
                  </span>
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
