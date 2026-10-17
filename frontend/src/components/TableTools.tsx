import { useCallback, useEffect, useRef, useState } from 'react'
import { Columns3, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'
import clsx from 'clsx'

export type ColumnDef = { id: string; label: string; locked?: boolean }

/**
 * คอลัมน์ที่เลือกแสดง — จำไว้ในเครื่อง (localStorage) แยกตามหน้า
 * locked = เปิดเสมอ ซ่อนไม่ได้ (เช่น VN / AN / สถานะ)
 */
export function useColumnPrefs(storageKey: string, columns: ColumnDef[], defaultHidden: string[] = []) {
  const [hidden, setHidden] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) return new Set(JSON.parse(raw) as string[])
    } catch { /* โหมดส่วนตัว อ่านไม่ได้ก็ใช้ค่าเริ่มต้น */ }
    return new Set(defaultHidden)
  })
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify([...hidden])) } catch { /* ignore */ }
  }, [storageKey, hidden])

  // ฟังก์ชันคงที่ (เปลี่ยนเมื่อเลือกคอลัมน์ใหม่เท่านั้น) — แถวที่ memo ไว้จะได้ไม่ render ซ้ำ
  const show = useCallback((id: string) => !hidden.has(id), [hidden])
  const toggle = (id: string) => setHidden(h => {
    const n = new Set(h)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    return n
  })
  const reset = () => setHidden(new Set(defaultHidden))
  const visibleCount = columns.filter(c => c.locked || show(c.id)).length
  return { show, toggle, reset, visibleCount, columns }
}

export function ColumnPicker({ prefs }: { prefs: ReturnType<typeof useColumnPrefs> }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-700 bg-white hover:bg-gray-50">
        <Columns3 className="w-4 h-4" /> คอลัมน์
      </button>
      {open && (
        <div className="absolute right-0 mt-1 z-30 w-60 bg-white border border-gray-200 rounded-lg shadow-lg p-2">
          <div className="max-h-80 overflow-y-auto">
            {prefs.columns.filter(c => c.label).map(c => (
              <label key={c.id} className={clsx('flex items-center gap-2 px-2 py-1 rounded text-sm',
                c.locked ? 'text-gray-400' : 'hover:bg-gray-50 cursor-pointer text-gray-700')}>
                <input type="checkbox" checked={c.locked || prefs.show(c.id)} disabled={c.locked}
                  onChange={() => prefs.toggle(c.id)} />
                {c.label}
              </label>
            ))}
          </div>
          <button type="button" onClick={prefs.reset}
            className="mt-1 w-full text-xs text-blue-700 hover:underline py-1">คืนค่าเริ่มต้น</button>
        </div>
      )}
    </div>
  )
}

/** แบ่งหน้าฝั่งหน้าเว็บ — render เฉพาะแถวในหน้าปัจจุบัน */
export function usePagination<T>(rows: T[], resetKey: unknown, initialSize = 50) {
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(initialSize)
  // เปลี่ยนตัวกรอง/ข้อมูลชุดใหม่ -> กลับหน้าแรก
  useEffect(() => { setPage(1) }, [resetKey, size])
  const pages = Math.max(1, Math.ceil(rows.length / size))
  const cur = Math.min(page, pages)
  const slice = rows.slice((cur - 1) * size, cur * size)
  return { page: cur, pages, size, setPage, setSize, slice, total: rows.length }
}

export function Pagination({ p }: { p: ReturnType<typeof usePagination<any>> }) {
  if (p.total === 0) return null
  const from = (p.page - 1) * p.size + 1
  const to = Math.min(p.total, p.page * p.size)
  const btn = 'p-1.5 rounded border border-gray-300 bg-white disabled:opacity-40 hover:bg-gray-50'
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-t bg-gray-50 text-sm text-gray-600">
      <span>แสดง {from.toLocaleString()}–{to.toLocaleString()} จาก {p.total.toLocaleString()} รายการ</span>
      <div className="flex items-center gap-2">
        <select value={p.size} onChange={e => p.setSize(Number(e.target.value))}
          className="border border-gray-300 rounded px-2 py-1 text-sm bg-white">
          {[25, 50, 100, 200].map(n => <option key={n} value={n}>{n} / หน้า</option>)}
        </select>
        <button type="button" className={btn} disabled={p.page <= 1} onClick={() => p.setPage(1)}><ChevronsLeft className="w-4 h-4" /></button>
        <button type="button" className={btn} disabled={p.page <= 1} onClick={() => p.setPage(p.page - 1)}><ChevronLeft className="w-4 h-4" /></button>
        <span className="px-1 tabular-nums">หน้า {p.page} / {p.pages}</span>
        <button type="button" className={btn} disabled={p.page >= p.pages} onClick={() => p.setPage(p.page + 1)}><ChevronRight className="w-4 h-4" /></button>
        <button type="button" className={btn} disabled={p.page >= p.pages} onClick={() => p.setPage(p.pages)}><ChevronsRight className="w-4 h-4" /></button>
      </div>
    </div>
  )
}
