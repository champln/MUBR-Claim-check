import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  Search, Trash2, Eye, BarChart2, RefreshCw, Download,
  CheckCircle2, XCircle, AlertTriangle, Clock, Filter
} from 'lucide-react'
import clsx from 'clsx'
import { getBatches, deleteBatch, exportReport } from '../lib/api'
import { CLAIM_TYPE_LABELS, MONTHS_TH } from '../types/claim'
import type { ClaimBatch, ClaimType } from '../types/claim'

const STATUS_CONFIG = {
  COMPLETED: { label: 'เสร็จสิ้น', cls: 'bg-blue-100 text-blue-800' },
  PROCESSING: { label: 'กำลังประมวลผล', cls: 'badge-pending' },
  FAILED: { label: 'ล้มเหลว', cls: 'badge-failed' },
}

function ProgressBar({ passed, failed, flagged, total }: {
  passed: number; failed: number; flagged: number; total: number
}) {
  if (!total) return null
  const pct = (n: number) => `${((n / total) * 100).toFixed(0)}%`
  return (
    <div className="flex h-2 rounded-full overflow-hidden bg-gray-100 w-36">
      <div className="bg-green-500 transition-all" style={{ width: pct(passed) }} />
      <div className="bg-amber-400 transition-all" style={{ width: pct(flagged) }} />
      <div className="bg-red-400 transition-all" style={{ width: pct(failed) }} />
    </div>
  )
}

export default function BatchListPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<string>('')
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null)

  const { data: batches = [], isLoading } = useQuery({
    queryKey: ['batches'],
    queryFn: () => getBatches({ limit: 200 }),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteBatch,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['batches'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      toast.success('ลบ Batch เรียบร้อยแล้ว')
      setConfirmDelete(null)
    },
    onError: () => toast.error('ไม่สามารถลบ Batch ได้'),
  })

  const filtered = batches.filter(b => {
    const matchType = !typeFilter || b.claim_type === typeFilter
    const matchSearch = !search ||
      b.batch_no.toLowerCase().includes(search.toLowerCase()) ||
      b.filename.toLowerCase().includes(search.toLowerCase())
    return matchType && matchSearch
  })

  const handleExport = async (b: ClaimBatch) => {
    try {
      await exportReport(b.id, b.batch_no)
      toast.success('ส่งออกรายงานแล้ว')
    } catch {
      toast.error('ไม่สามารถส่งออกรายงานได้')
    }
  }

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="card p-4 flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="ค้นหา Batch หรือชื่อไฟล์..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="input pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-gray-400" />
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            className="input w-auto"
          >
            <option value="">สิทธิ์ทั้งหมด</option>
            {Object.entries(CLAIM_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <span className="text-sm text-gray-500">{filtered.length} Batch</span>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <div className="animate-spin w-7 h-7 border-4 border-blue-600 border-t-transparent rounded-full" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <BarChart2 className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>ยังไม่มีข้อมูล Batch</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr>
                  <th className="table-header">Batch No.</th>
                  <th className="table-header">ไฟล์</th>
                  <th className="table-header">สิทธิ์</th>
                  <th className="table-header">งวด</th>
                  <th className="table-header">รายการ</th>
                  <th className="table-header">ผลการตรวจ</th>
                  <th className="table-header">ยอดรวม</th>
                  <th className="table-header">สถานะ</th>
                  <th className="table-header">วันที่</th>
                  <th className="table-header text-center">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(b => {
                  const sc = STATUS_CONFIG[b.status] || STATUS_CONFIG.FAILED
                  return (
                    <tr key={b.id} className="hover:bg-gray-50 transition-colors">
                      <td className="table-cell font-mono text-xs text-blue-700 font-medium">
                        {b.batch_no}
                      </td>
                      <td className="table-cell text-xs max-w-36 truncate" title={b.filename}>
                        {b.filename}
                      </td>
                      <td className="table-cell text-xs">
                        {CLAIM_TYPE_LABELS[b.claim_type]}
                      </td>
                      <td className="table-cell text-xs">
                        {b.period_month
                          ? `${MONTHS_TH[b.period_month]?.substring(0, 3)} ${(b.period_year || 0) + 543}`
                          : '-'}
                      </td>
                      <td className="table-cell text-center font-medium">
                        {b.total_records}
                      </td>
                      <td className="table-cell">
                        <div className="space-y-1">
                          <ProgressBar
                            passed={b.passed_records}
                            failed={b.failed_records}
                            flagged={b.flagged_records}
                            total={b.total_records}
                          />
                          <div className="flex gap-2 text-xs">
                            <span className="text-green-600 flex items-center gap-0.5">
                              <CheckCircle2 className="w-3 h-3" />{b.passed_records}
                            </span>
                            <span className="text-amber-600 flex items-center gap-0.5">
                              <AlertTriangle className="w-3 h-3" />{b.flagged_records}
                            </span>
                            <span className="text-red-600 flex items-center gap-0.5">
                              <XCircle className="w-3 h-3" />{b.failed_records}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="table-cell text-xs font-medium">
                        ฿{b.total_amount.toLocaleString('th-TH', { maximumFractionDigits: 0 })}
                      </td>
                      <td className="table-cell">
                        <span className={clsx(
                          'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
                          sc.cls
                        )}>
                          {sc.label}
                        </span>
                      </td>
                      <td className="table-cell text-xs text-gray-500">
                        {new Date(b.created_at).toLocaleDateString('th-TH')}
                      </td>
                      <td className="table-cell">
                        <div className="flex items-center gap-1 justify-center">
                          <button
                            onClick={() => navigate(`/batches/${b.id}`)}
                            className="p-1.5 rounded hover:bg-blue-50 text-blue-600"
                            title="ดูรายละเอียด"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleExport(b)}
                            className="p-1.5 rounded hover:bg-green-50 text-green-600"
                            title="ส่งออก Excel"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                          {confirmDelete === b.id ? (
                            <div className="flex gap-1">
                              <button
                                onClick={() => deleteMutation.mutate(b.id)}
                                className="px-2 py-1 text-xs bg-red-600 text-white rounded"
                              >ยืนยัน</button>
                              <button
                                onClick={() => setConfirmDelete(null)}
                                className="px-2 py-1 text-xs bg-gray-200 rounded"
                              >ยกเลิก</button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setConfirmDelete(b.id)}
                              className="p-1.5 rounded hover:bg-red-50 text-red-500"
                              title="ลบ"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
