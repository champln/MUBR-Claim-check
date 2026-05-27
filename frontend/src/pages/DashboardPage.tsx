import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts'
import {
  FileCheck2, FileX2, AlertTriangle, Layers,
  TrendingUp, Clock, CheckCircle2, XCircle
} from 'lucide-react'
import { getDashboard, getBatches } from '../lib/api'
import { CLAIM_TYPE_LABELS, ERROR_CATEGORY_LABELS, MONTHS_TH } from '../types/claim'
import type { ClaimBatch } from '../types/claim'

const PIE_COLORS = ['#22c55e', '#ef4444', '#f59e0b', '#94a3b8']
const BAR_COLORS = { passed: '#22c55e', failed: '#ef4444' }

function StatCard({
  icon: Icon, label, value, sub, color
}: {
  icon: React.ElementType; label: string; value: number | string
  sub?: string; color: string
}) {
  return (
    <div className="card p-5 flex items-start gap-4">
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${color}`}>
        <Icon className="w-6 h-6 text-white" />
      </div>
      <div>
        <p className="text-sm text-gray-500">{label}</p>
        <p className="text-2xl font-bold text-gray-900 mt-0.5">{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

function BatchStatusBadge({ status }: { status: string }) {
  const classes: Record<string, string> = {
    PASSED: 'badge-passed',
    FAILED: 'badge-failed',
    FLAGGED_C: 'badge-flagged',
    PENDING: 'badge-pending',
    COMPLETED: 'bg-blue-100 text-blue-800 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
  }
  const labels: Record<string, string> = {
    PASSED: 'ผ่าน', FAILED: 'ไม่ผ่าน', FLAGGED_C: 'ติด C',
    PENDING: 'รอตรวจ', COMPLETED: 'เสร็จสิ้น',
  }
  return <span className={classes[status] || 'badge-pending'}>{labels[status] || status}</span>
}

export default function DashboardPage() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: getDashboard,
    refetchInterval: 30000,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
      </div>
    )
  }

  const pieData = stats ? [
    { name: 'ผ่าน', value: stats.total_passed },
    { name: 'ไม่ผ่าน', value: stats.total_failed },
    { name: 'ติด C', value: stats.total_flagged_c },
    { name: 'รอตรวจ', value: stats.total_claims - stats.total_passed - stats.total_failed - stats.total_flagged_c },
  ] : []

  const barData = (stats?.monthly_summary || [])
    .slice()
    .reverse()
    .map(m => ({
      name: m.month ? `${MONTHS_TH[m.month]?.substring(0, 3)} ${(m.year || 0) + 543}` : '-',
      ผ่าน: m.passed,
      ไม่ผ่าน: m.failed,
      รวม: m.total,
    }))

  const errData = (stats?.error_type_summary || []).map(e => ({
    name: ERROR_CATEGORY_LABELS[e.category] || e.category,
    count: e.count,
  }))

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Layers} label="Batch ทั้งหมด" value={stats?.total_batches ?? 0}
          color="bg-blue-600" />
        <StatCard icon={CheckCircle2} label="ผ่านการตรวจสอบ" value={stats?.total_passed ?? 0}
          color="bg-green-500" sub={`จาก ${stats?.total_claims ?? 0} รายการ`} />
        <StatCard icon={XCircle} label="ไม่ผ่าน / ติด C"
          value={(stats?.total_failed ?? 0) + (stats?.total_flagged_c ?? 0)}
          color="bg-red-500" />
        <StatCard icon={TrendingUp} label="ยอดรวมค่ารักษา"
          value={`฿${(stats?.total_amount ?? 0).toLocaleString('th-TH', { maximumFractionDigits: 0 })}`}
          color="bg-purple-600" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Pie chart */}
        <div className="card p-5">
          <h3 className="font-semibold text-gray-900 mb-4">สัดส่วนผลการตรวจสอบ</h3>
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" outerRadius={80}
                dataKey="value" nameKey="name" label={({ name, percent }) =>
                  percent > 0.03 ? `${name} ${(percent * 100).toFixed(0)}%` : ''}>
                {pieData.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i]} />
                ))}
              </Pie>
              <Legend />
              <Tooltip formatter={(val) => [`${val} รายการ`]} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Bar chart monthly */}
        <div className="card p-5 lg:col-span-2">
          <h3 className="font-semibold text-gray-900 mb-4">ผลการตรวจสอบรายเดือน</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={barData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Bar dataKey="ผ่าน" fill={BAR_COLORS.passed} radius={[3, 3, 0, 0]} />
              <Bar dataKey="ไม่ผ่าน" fill={BAR_COLORS.failed} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Error types */}
        <div className="card p-5">
          <h3 className="font-semibold text-gray-900 mb-4">ประเภทข้อผิดพลาดที่พบบ่อย</h3>
          {errData.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">ยังไม่มีข้อมูล</p>
          ) : (
            <div className="space-y-3">
              {errData.slice(0, 6).map((e, i) => {
                const max = errData[0]?.count || 1
                return (
                  <div key={i}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-gray-700">{e.name}</span>
                      <span className="font-medium text-gray-900">{e.count}</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full">
                      <div
                        className="h-2 bg-blue-500 rounded-full transition-all"
                        style={{ width: `${(e.count / max) * 100}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Recent batches */}
        <div className="card p-5">
          <h3 className="font-semibold text-gray-900 mb-4">Batch ล่าสุด</h3>
          {(stats?.recent_batches || []).length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">ยังไม่มี Batch</p>
          ) : (
            <div className="space-y-3">
              {stats?.recent_batches.map(b => (
                <div key={b.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{b.batch_no}</p>
                    <p className="text-xs text-gray-500">
                      {CLAIM_TYPE_LABELS[b.claim_type]} · {b.total_records} รายการ
                    </p>
                  </div>
                  <div className="text-right">
                    <BatchStatusBadge status={b.status} />
                    <p className="text-xs text-gray-400 mt-1">
                      {new Date(b.created_at).toLocaleDateString('th-TH')}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
