import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts'
import { Download, BarChart3, FileSpreadsheet } from 'lucide-react'
import { getBatches, exportReport } from '../lib/api'
import { CLAIM_TYPE_LABELS, ERROR_CATEGORY_LABELS, MONTHS_TH } from '../types/claim'

const PIE_COLORS = ['#3b82f6', '#22c55e', '#ef4444', '#f59e0b', '#8b5cf6', '#06b6d4']

export default function ReportsPage() {
  const [selectedBatch, setSelectedBatch] = useState<number | null>(null)

  const { data: batches = [] } = useQuery({
    queryKey: ['batches'],
    queryFn: () => getBatches({ limit: 200 }),
  })

  const handleExport = async (batchId: number, batchNo: string) => {
    try {
      await exportReport(batchId, batchNo)
      toast.success('ส่งออกรายงาน Excel เรียบร้อยแล้ว')
    } catch {
      toast.error('ไม่สามารถส่งออกรายงานได้')
    }
  }

  // Aggregate stats by claim type
  const byType = batches.reduce<Record<string, { total: number; passed: number; failed: number; flagged: number; amount: number }>>(
    (acc, b) => {
      const key = b.claim_type
      if (!acc[key]) acc[key] = { total: 0, passed: 0, failed: 0, flagged: 0, amount: 0 }
      acc[key].total += b.total_records
      acc[key].passed += b.passed_records
      acc[key].failed += b.failed_records
      acc[key].flagged += b.flagged_records
      acc[key].amount += b.total_amount
      return acc
    }, {}
  )

  const typeChartData = Object.entries(byType).map(([k, v]) => ({
    name: CLAIM_TYPE_LABELS[k as keyof typeof CLAIM_TYPE_LABELS] || k,
    ผ่าน: v.passed,
    ไม่ผ่าน: v.failed,
    'ติด C': v.flagged,
  }))

  const pieData = Object.entries(byType).map(([k, v]) => ({
    name: CLAIM_TYPE_LABELS[k as keyof typeof CLAIM_TYPE_LABELS] || k,
    value: v.total,
  }))

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Claim type bar chart */}
        <div className="card p-5">
          <h3 className="font-semibold text-gray-900 mb-4">ผลการตรวจสอบแยกตามสิทธิ์</h3>
          {typeChartData.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-10">ยังไม่มีข้อมูล</p>
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={typeChartData} margin={{ top: 5, right: 10, left: 0, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-15} textAnchor="end" />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="ผ่าน" fill="#22c55e" radius={[3, 3, 0, 0]} />
                <Bar dataKey="ไม่ผ่าน" fill="#ef4444" radius={[3, 3, 0, 0]} />
                <Bar dataKey="ติด C" fill="#f59e0b" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Pie by type */}
        <div className="card p-5">
          <h3 className="font-semibold text-gray-900 mb-4">สัดส่วนรายการแยกตามสิทธิ์</h3>
          {pieData.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-10">ยังไม่มีข้อมูล</p>
          ) : (
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" outerRadius={90}
                  dataKey="value" nameKey="name"
                  label={({ name, percent }) => percent > 0.04 ? `${(percent * 100).toFixed(0)}%` : ''}>
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Legend />
                <Tooltip formatter={v => [`${v} รายการ`]} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Summary table by type */}
      <div className="card p-5">
        <h3 className="font-semibold text-gray-900 mb-4">สรุปรายงานแยกตามสิทธิ์</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="table-header">สิทธิ์การรักษา</th>
                <th className="table-header text-right">รายการทั้งหมด</th>
                <th className="table-header text-right">ผ่าน</th>
                <th className="table-header text-right">ติด C</th>
                <th className="table-header text-right">ไม่ผ่าน</th>
                <th className="table-header text-right">อัตราผ่าน %</th>
                <th className="table-header text-right">ยอดรวม (บาท)</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(byType).map(([k, v]) => (
                <tr key={k} className="hover:bg-gray-50">
                  <td className="table-cell font-medium">{CLAIM_TYPE_LABELS[k as keyof typeof CLAIM_TYPE_LABELS] || k}</td>
                  <td className="table-cell text-right">{v.total.toLocaleString()}</td>
                  <td className="table-cell text-right text-green-700">{v.passed.toLocaleString()}</td>
                  <td className="table-cell text-right text-amber-700">{v.flagged.toLocaleString()}</td>
                  <td className="table-cell text-right text-red-700">{v.failed.toLocaleString()}</td>
                  <td className="table-cell text-right font-medium">
                    {v.total ? ((v.passed / v.total) * 100).toFixed(1) : '0'}%
                  </td>
                  <td className="table-cell text-right">
                    {v.amount.toLocaleString('th-TH', { maximumFractionDigits: 0 })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Export by batch */}
      <div className="card p-5">
        <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <FileSpreadsheet className="w-5 h-5 text-green-600" />
          ส่งออกรายงานรายละเอียด (Excel)
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="table-header">Batch No.</th>
                <th className="table-header">สิทธิ์</th>
                <th className="table-header">งวด</th>
                <th className="table-header text-right">รายการ</th>
                <th className="table-header text-right">ผ่าน</th>
                <th className="table-header text-right">ไม่ผ่าน</th>
                <th className="table-header">วันที่</th>
                <th className="table-header text-center">ส่งออก</th>
              </tr>
            </thead>
            <tbody>
              {batches.slice(0, 20).map(b => (
                <tr key={b.id} className="hover:bg-gray-50">
                  <td className="table-cell font-mono text-xs text-blue-700">{b.batch_no}</td>
                  <td className="table-cell text-xs">{CLAIM_TYPE_LABELS[b.claim_type]}</td>
                  <td className="table-cell text-xs">
                    {b.period_month ? `${MONTHS_TH[b.period_month]?.substring(0, 3)} ${(b.period_year || 0) + 543}` : '-'}
                  </td>
                  <td className="table-cell text-right">{b.total_records}</td>
                  <td className="table-cell text-right text-green-700">{b.passed_records}</td>
                  <td className="table-cell text-right text-red-700">{b.failed_records}</td>
                  <td className="table-cell text-xs text-gray-500">
                    {new Date(b.created_at).toLocaleDateString('th-TH')}
                  </td>
                  <td className="table-cell text-center">
                    <button
                      onClick={() => handleExport(b.id, b.batch_no)}
                      className="inline-flex items-center gap-1 px-3 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700"
                    >
                      <Download className="w-3 h-3" /> ดาวน์โหลด
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
