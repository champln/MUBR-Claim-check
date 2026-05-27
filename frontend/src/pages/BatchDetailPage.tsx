import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  ArrowLeft, Download, RefreshCw, Search, ChevronDown, ChevronRight,
  CheckCircle2, XCircle, AlertTriangle, Info, Filter
} from 'lucide-react'
import clsx from 'clsx'
import { getBatch, getClaims, getPrescreenSummary, rerunPrescreen, exportReport } from '../lib/api'
import {
  CLAIM_TYPE_LABELS, STATUS_LABELS, ERROR_CATEGORY_LABELS, MONTHS_TH
} from '../types/claim'
import type { ClaimRecord, ClaimStatus } from '../types/claim'

const SEVERITY_COLOR = {
  ERROR: 'text-red-700 bg-red-50',
  WARNING: 'text-amber-700 bg-amber-50',
  INFO: 'text-blue-700 bg-blue-50',
}
const SEVERITY_ICON = {
  ERROR: XCircle,
  WARNING: AlertTriangle,
  INFO: Info,
}

function StatusBadge({ status }: { status: ClaimStatus }) {
  const cfg: Record<string, string> = {
    PASSED: 'badge-passed',
    FAILED: 'badge-failed',
    FLAGGED_C: 'badge-flagged',
    PENDING: 'badge-pending',
    CORRECTED: 'bg-purple-100 text-purple-800 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
  }
  return <span className={cfg[status] || 'badge-pending'}>{STATUS_LABELS[status] || status}</span>
}

function ClaimRow({ claim }: { claim: ClaimRecord }) {
  const [expanded, setExpanded] = useState(false)
  const errorCount = claim.errors.filter(e => e.severity === 'ERROR').length
  const warnCount = claim.errors.filter(e => e.severity === 'WARNING').length

  return (
    <>
      <tr
        className={clsx(
          'hover:bg-gray-50 transition-colors cursor-pointer',
          claim.is_flagged_c && 'bg-amber-50 border-l-2 border-l-amber-400'
        )}
        onClick={() => setExpanded(!expanded)}
      >
        <td className="table-cell w-8">
          {claim.errors.length > 0 ? (
            expanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />
          ) : null}
        </td>
        <td className="table-cell text-xs text-gray-500">{claim.row_number}</td>
        <td className="table-cell font-mono text-xs">{claim.hn || '-'}</td>
        <td className="table-cell text-xs">{claim.patient_name || '-'}</td>
        <td className="table-cell text-xs">{claim.visit_date || '-'}</td>
        <td className="table-cell text-xs">{claim.visit_type || '-'}</td>
        <td className="table-cell font-mono text-xs">{claim.pdx || '-'}</td>
        <td className="table-cell text-xs font-medium">
          {claim.total_charge.toLocaleString('th-TH', { maximumFractionDigits: 0 })}
        </td>
        <td className="table-cell"><StatusBadge status={claim.status} /></td>
        <td className="table-cell">
          <div className="flex gap-1.5">
            {errorCount > 0 && (
              <span className="flex items-center gap-0.5 text-xs text-red-700 bg-red-50 px-1.5 py-0.5 rounded">
                <XCircle className="w-3 h-3" />{errorCount}
              </span>
            )}
            {warnCount > 0 && (
              <span className="flex items-center gap-0.5 text-xs text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">
                <AlertTriangle className="w-3 h-3" />{warnCount}
              </span>
            )}
          </div>
        </td>
      </tr>
      {expanded && claim.errors.length > 0 && (
        <tr>
          <td colSpan={10} className="bg-gray-50 px-10 py-3">
            <div className="space-y-2">
              {claim.errors.map(err => {
                const Icon = SEVERITY_ICON[err.severity]
                return (
                  <div
                    key={err.id}
                    className={clsx('flex items-start gap-2.5 p-2.5 rounded-lg text-xs', SEVERITY_COLOR[err.severity])}
                  >
                    <Icon className="w-4 h-4 shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <div className="flex gap-2 flex-wrap">
                        <span className="font-mono font-bold">{err.error_code}</span>
                        <span className="opacity-70">
                          [{ERROR_CATEGORY_LABELS[err.error_category || ''] || err.error_category}]
                        </span>
                        <span className="opacity-70">Field: {err.error_field}</span>
                      </div>
                      <p className="mt-0.5">{err.error_message_th || err.error_message}</p>
                      {err.current_value && (
                        <p className="mt-0.5 opacity-70">
                          ค่าที่พบ: <code>{err.current_value}</code>
                          {err.expected_value && <> → ควรเป็น: <code>{err.expected_value}</code></>}
                        </p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

export default function BatchDetailPage() {
  const { batchId } = useParams<{ batchId: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const id = Number(batchId)

  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 50

  const { data: batch } = useQuery({ queryKey: ['batch', id], queryFn: () => getBatch(id) })
  const { data: summary } = useQuery({
    queryKey: ['summary', id],
    queryFn: () => getPrescreenSummary(id),
  })
  const { data: claims = [], isLoading } = useQuery({
    queryKey: ['claims', id, statusFilter, search, page],
    queryFn: () => getClaims(id, {
      skip: page * PAGE_SIZE,
      limit: PAGE_SIZE,
      status: statusFilter || undefined,
      search: search || undefined,
    }),
  })

  const rerunMutation = useMutation({
    mutationFn: () => rerunPrescreen(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['batch', id] })
      qc.invalidateQueries({ queryKey: ['summary', id] })
      qc.invalidateQueries({ queryKey: ['claims', id] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      toast.success('ตรวจสอบซ้ำเสร็จสิ้น')
    },
    onError: () => toast.error('เกิดข้อผิดพลาด'),
  })

  if (!batch) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
    </div>
  )

  const passRate = batch.total_records
    ? ((batch.passed_records / batch.total_records) * 100).toFixed(1)
    : '0'

  return (
    <div className="space-y-5">
      {/* Back + Actions */}
      <div className="flex items-center justify-between">
        <button onClick={() => navigate('/batches')} className="btn-secondary">
          <ArrowLeft className="w-4 h-4" /> กลับ
        </button>
        <div className="flex gap-2">
          <button
            onClick={() => rerunMutation.mutate()}
            disabled={rerunMutation.isPending}
            className="btn-secondary"
          >
            <RefreshCw className={clsx('w-4 h-4', rerunMutation.isPending && 'animate-spin')} />
            ตรวจสอบซ้ำ
          </button>
          <button
            onClick={() => exportReport(id, batch.batch_no)}
            className="btn-primary"
          >
            <Download className="w-4 h-4" /> ส่งออก Excel
          </button>
        </div>
      </div>

      {/* Batch Info */}
      <div className="card p-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-gray-500">Batch No.</p>
            <p className="font-mono font-bold text-blue-700">{batch.batch_no}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">ไฟล์</p>
            <p className="text-sm font-medium truncate">{batch.filename}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">สิทธิ์</p>
            <p className="text-sm">{CLAIM_TYPE_LABELS[batch.claim_type]}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">งวด</p>
            <p className="text-sm">
              {batch.period_month
                ? `${MONTHS_TH[batch.period_month]} ${(batch.period_year || 0) + 543}`
                : '-'}
            </p>
          </div>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'ทั้งหมด', value: batch.total_records, color: 'text-gray-900', bg: 'bg-gray-50' },
          { label: 'ผ่าน', value: batch.passed_records, color: 'text-green-700', bg: 'bg-green-50' },
          { label: 'ติด C', value: batch.flagged_records, color: 'text-amber-700', bg: 'bg-amber-50' },
          { label: 'ไม่ผ่าน', value: batch.failed_records, color: 'text-red-700', bg: 'bg-red-50' },
          { label: 'อัตราผ่าน', value: `${passRate}%`, color: 'text-blue-700', bg: 'bg-blue-50' },
        ].map(s => (
          <div key={s.label} className={clsx('card p-4 text-center', s.bg)}>
            <p className={clsx('text-2xl font-bold', s.color)}>{s.value}</p>
            <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Top errors */}
      {summary && summary.top_errors.length > 0 && (
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-gray-800 mb-3">ข้อผิดพลาดที่พบมากที่สุด</h3>
          <div className="flex flex-wrap gap-2">
            {summary.top_errors.slice(0, 8).map(e => (
              <div key={e.code}
                className="flex items-center gap-1.5 bg-red-50 border border-red-200 rounded-lg px-3 py-1.5 text-xs">
                <span className="font-mono font-bold text-red-700">{e.code}</span>
                <span className="text-gray-600">{e.message_th}</span>
                <span className="bg-red-200 text-red-800 rounded-full px-1.5 py-0.5 font-bold">{e.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card p-4 flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="ค้นหา HN / เลขบัตร / ชื่อ..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0) }}
            className="input pl-9"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(0) }}
          className="input w-auto"
        >
          <option value="">สถานะทั้งหมด</option>
          <option value="PASSED">ผ่าน</option>
          <option value="FAILED">ไม่ผ่าน</option>
          <option value="FLAGGED_C">ติด C</option>
          <option value="PENDING">รอตรวจ</option>
        </select>
        <span className="text-sm text-gray-500">คลิกแถวเพื่อดูรายละเอียดข้อผิดพลาด</span>
      </div>

      {/* Claims Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-header w-8" />
                <th className="table-header">แถว</th>
                <th className="table-header">HN</th>
                <th className="table-header">ชื่อผู้ป่วย</th>
                <th className="table-header">วันที่</th>
                <th className="table-header">ประเภท</th>
                <th className="table-header">PDX</th>
                <th className="table-header">ยอดรวม</th>
                <th className="table-header">สถานะ</th>
                <th className="table-header">ข้อผิดพลาด</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center">
                    <div className="animate-spin w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full mx-auto" />
                  </td>
                </tr>
              ) : claims.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-12 text-center text-gray-400 text-sm">
                    ไม่พบข้อมูล
                  </td>
                </tr>
              ) : (
                claims.map(c => <ClaimRow key={c.id} claim={c} />)
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
          <p className="text-sm text-gray-500">
            แสดง {page * PAGE_SIZE + 1} - {page * PAGE_SIZE + claims.length} รายการ
          </p>
          <div className="flex gap-2">
            <button
              disabled={page === 0}
              onClick={() => setPage(p => p - 1)}
              className="btn-secondary py-1 px-3 text-xs"
            >← ก่อนหน้า</button>
            <button
              disabled={claims.length < PAGE_SIZE}
              onClick={() => setPage(p => p + 1)}
              className="btn-secondary py-1 px-3 text-xs"
            >ถัดไป →</button>
          </div>
        </div>
      </div>
    </div>
  )
}
