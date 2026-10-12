import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { History, RotateCcw, Trash2, CalendarRange, Search } from 'lucide-react'
import clsx from 'clsx'
import {
  listFixHistory, listFixHistoryFiscalYears, listFixHistoryMenus,
  downloadFixHistory, deleteFixHistory, clearFixHistory,
  FIX_HISTORY_EVENT, type FixHistoryItem,
} from '../lib/api'

/**
 * ประวัติการแก้ไฟล์ + โหลดไฟล์ที่แก้แล้วย้อนหลัง (ใช้ร่วมกันทุกเมนูแก้ไฟล์)
 * menu  : แสดงเฉพาะเมนูนั้น — ไม่ระบุ = ทุกเมนู (มีตัวกรองเมนูให้เลือก)
 */
export default function FixHistoryPanel({ menu }: { menu?: string }) {
  const qc = useQueryClient()
  const [fy, setFy] = useState<number | null>(null)
  const [q, setQ] = useState('')
  const [menuFilter, setMenuFilter] = useState('')
  const activeMenu = menu || menuFilter

  const history = useQuery({
    queryKey: ['fix-history', activeMenu, fy, q],
    queryFn: () => listFixHistory({ menu: activeMenu, fiscal_year: fy, q }),
  })
  const years = useQuery({
    queryKey: ['fix-history-years', activeMenu],
    queryFn: () => listFixHistoryFiscalYears(activeMenu),
  })
  const menus = useQuery({
    queryKey: ['fix-history-menus'],
    queryFn: listFixHistoryMenus,
    enabled: !menu,
  })

  // เมนูไหนแก้ไฟล์เสร็จ (มี X-History-Id) -> โหลดรายการใหม่ทันที
  useEffect(() => {
    const refresh = () => {
      qc.invalidateQueries({ queryKey: ['fix-history'] })
      qc.invalidateQueries({ queryKey: ['fix-history-years'] })
      qc.invalidateQueries({ queryKey: ['fix-history-menus'] })
    }
    window.addEventListener(FIX_HISTORY_EVENT, refresh)
    return () => window.removeEventListener(FIX_HISTORY_EVENT, refresh)
  }, [qc])

  const refreshAll = () => window.dispatchEvent(new Event(FIX_HISTORY_EVENT))

  const deleteMutation = useMutation({
    mutationFn: deleteFixHistory,
    onSuccess: () => { toast.success('ลบประวัติแล้ว'); refreshAll() },
    onError: () => toast.error('ลบไม่สำเร็จ'),
  })
  const clearMutation = useMutation({
    mutationFn: (year: number) => clearFixHistory(year, activeMenu),
    onSuccess: (res) => { toast.success(res.message); setFy(null); refreshAll() },
    onError: () => toast.error('เคลียร์ไม่สำเร็จ'),
  })

  const rows = history.data || []

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-3 flex-wrap">
        <h3 className="font-semibold text-gray-800 text-sm flex items-center gap-2">
          <History className="w-4 h-4 text-blue-600" /> ประวัติการแก้ไฟล์
          <span className="text-xs font-normal text-gray-400">{rows.length} รายการล่าสุด</span>
        </h3>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          {!menu && (
            <select value={menuFilter} onChange={e => { setMenuFilter(e.target.value); setFy(null) }}
              className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm">
              <option value="">ทุกเมนู</option>
              {(menus.data || []).map(m => (
                <option key={m.menu} value={m.menu}>{m.label} ({m.count})</option>
              ))}
            </select>
          )}
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="ค้นหาเลขงวด / AN / ชื่อไฟล์"
              className="border border-gray-300 rounded-lg pl-8 pr-3 py-1.5 text-sm w-52" />
          </div>
          <CalendarRange className="w-4 h-4 text-gray-400" />
          <select value={fy ?? ''} onChange={e => setFy(e.target.value ? Number(e.target.value) : null)}
            className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm">
            <option value="">ทุกปีงบ</option>
            {(years.data || []).filter(y => y.fiscal_year != null).map(y => (
              <option key={y.fiscal_year!} value={y.fiscal_year!}>ปีงบ {y.fiscal_year} ({y.count})</option>
            ))}
          </select>
          {fy != null && (
            <button type="button" disabled={clearMutation.isPending}
              onClick={() => { if (confirm(`ลบประวัติทั้งหมดของปีงบ ${fy}${menu ? ' ในเมนูนี้' : activeMenu ? ' ของเมนูที่เลือก' : ' ทุกเมนู'}? (ลบถาวร)`)) clearMutation.mutate(fy) }}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-red-50 text-red-600 text-sm rounded-lg hover:bg-red-100 disabled:opacity-50">
              <Trash2 className="w-4 h-4" /> เคลียร์ปีงบ {fy}
            </button>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="p-8 text-center text-gray-400 text-sm">
          {history.isLoading ? 'กำลังโหลด...' : q || fy != null ? 'ไม่พบประวัติที่ตรงเงื่อนไข' : 'ยังไม่มีประวัติ — แก้ไฟล์ครั้งต่อไประบบจะเก็บไฟล์ไว้ให้โหลดซ้ำได้ที่นี่'}
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 max-h-[28rem] overflow-y-auto">
          {rows.map(h => <Row key={h.id} h={h} showMenu={!menu}
            onDownload={() => downloadFixHistory(h.id, h.result_filename || 'fixed').catch(() => toast.error('โหลดไม่สำเร็จ'))}
            onDelete={() => { if (confirm(`ลบประวัติ "${h.session_name}"?`)) deleteMutation.mutate(h.id) }} />)}
        </ul>
      )}
    </div>
  )
}

function Row({ h, showMenu, onDownload, onDelete }: {
  h: FixHistoryItem; showMenu: boolean; onDownload: () => void; onDelete: () => void
}) {
  const created = h.created_at ? new Date(h.created_at).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : ''
  return (
    <li className="flex items-center gap-4 px-5 py-3 hover:bg-gray-50">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-gray-800 text-sm">{h.session_name}</span>
          {showMenu && <span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full">{h.menu_label}</span>}
          {h.fiscal_year != null && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">ปีงบ {h.fiscal_year}</span>}
          <span className="text-xs text-gray-300">#{h.id}</span>
        </div>
        <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 flex-wrap">
          <span className="font-mono">{h.result_filename}</span>
          {h.service_date && <span>บริการ {h.service_date}</span>}
          <span>{(h.size_bytes / 1024).toFixed(1)} KB</span>
          {h.created_by && <span>โดย {h.created_by}</span>}
          <span className="text-gray-400">{created}</span>
        </div>
        {h.changes.length > 0 && (
          <div className={clsx('mt-1 text-xs text-green-700 truncate')} title={h.changes.join('\n')}>
            {h.changes.join(' · ')}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button onClick={onDownload}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-blue-600 text-sm font-medium rounded-lg hover:bg-blue-50">
          <RotateCcw className="w-4 h-4" /> โหลดซ้ำ
        </button>
        <button onClick={onDelete} className="p-1.5 text-gray-400 hover:text-red-500 rounded hover:bg-red-50">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </li>
  )
}
