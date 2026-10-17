import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, Search, X } from 'lucide-react'
import clsx from 'clsx'
import { getLivePttypes, type LivePttype } from '../lib/api'

/**
 * เลือกสิทธิการรักษาจากทะเบียน HOSxP — เลือกได้หลายสิทธิ หรือเลือกทั้งกลุ่ม (กรมบัญชีกลาง / อปท. ...)
 * value = รหัสสิทธิคั่นด้วย , (ว่าง = ทุกสิทธิ) เหมือนช่องพิมพ์เดิม
 */
export default function PttypePicker({ value, onChange, enabled }: {
  value: string
  onChange: (v: string) => void
  enabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  const listQuery = useQuery({
    queryKey: ['live-pttypes'],
    queryFn: getLivePttypes,
    enabled,
    staleTime: 30 * 60_000,
    retry: false,
  })
  const list = listQuery.data || []

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const selected = useMemo(() => new Set(value.split(',').map(s => s.trim()).filter(Boolean)), [value])
  const byCode = useMemo(() => new Map(list.map(p => [p.pttype, p])), [list])

  // กลุ่มสิทธิ เรียงตามจำนวน visit
  const groups = useMemo(() => {
    const m = new Map<string, LivePttype[]>()
    for (const p of list) m.set(p.group, [...(m.get(p.group) || []), p])
    return [...m.entries()].sort((a, b) =>
      b[1].reduce((s, p) => s + p.visits_90d, 0) - a[1].reduce((s, p) => s + p.visits_90d, 0))
  }, [list])

  const q = search.trim().toLowerCase()
  const match = (p: LivePttype) => !q || p.pttype.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)

  const set = (codes: Set<string>) => onChange([...codes].sort().join(','))
  const toggle = (code: string) => {
    const n = new Set(selected)
    if (n.has(code)) n.delete(code)
    else n.add(code)
    set(n)
  }
  const toggleGroup = (items: LivePttype[]) => {
    const all = items.every(p => selected.has(p.pttype))
    const n = new Set(selected)
    for (const p of items) {
      if (all) n.delete(p.pttype)
      else n.add(p.pttype)
    }
    set(n)
  }

  const label = selected.size === 0
    ? 'ทุกสิทธิ'
    : selected.size === 1
      ? (() => { const c = [...selected][0]; const p = byCode.get(c); return p ? `${c} ${p.name}` : c })()
      : `เลือก ${selected.size} สิทธิ`

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className="inline-flex items-center justify-between gap-2 border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white w-64 text-left">
        <span className={clsx('truncate', selected.size === 0 && 'text-gray-500')}>{label}</span>
        <span className="flex items-center gap-1 flex-shrink-0">
          {selected.size > 0 && (
            <X className="w-4 h-4 text-gray-400 hover:text-rose-500" aria-label="ล้างตัวกรองสิทธิ"
              onClick={e => { e.stopPropagation(); onChange('') }} />
          )}
          <ChevronDown className="w-4 h-4 text-gray-400" />
        </span>
      </button>

      {open && (
        <div className="absolute left-0 mt-1 z-30 w-[22rem] bg-white border border-gray-200 rounded-lg shadow-lg">
          <div className="p-2 border-b">
            <div className="flex items-center gap-2 border border-gray-300 rounded-md px-2 py-1">
              <Search className="w-4 h-4 text-gray-400" />
              <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
                placeholder="ค้นหารหัสหรือชื่อสิทธิ" className="flex-1 text-sm outline-none" />
            </div>
          </div>
          <div className="max-h-96 overflow-y-auto p-1">
            {listQuery.isLoading && <p className="px-3 py-4 text-sm text-gray-400">กำลังโหลดรายชื่อสิทธิจาก HOSxP...</p>}
            {listQuery.isError && <p className="px-3 py-4 text-sm text-rose-600">โหลดรายชื่อสิทธิไม่สำเร็จ</p>}
            {groups.map(([group, items]) => {
              const shown = items.filter(match)
              if (shown.length === 0) return null
              const all = items.every(p => selected.has(p.pttype))
              const some = !all && items.some(p => selected.has(p.pttype))
              return (
                <div key={group} className="mb-1">
                  <label className="flex items-center gap-2 px-2 py-1.5 text-xs font-semibold text-gray-600 bg-gray-50 rounded cursor-pointer">
                    <input type="checkbox" checked={all} ref={el => { if (el) el.indeterminate = some }}
                      onChange={() => toggleGroup(items)} />
                    {group} <span className="font-normal text-gray-400">({items.length} สิทธิ · เลือกทั้งกลุ่ม)</span>
                  </label>
                  {shown.map(p => (
                    <label key={p.pttype} className="flex items-center gap-2 pl-6 pr-2 py-1 rounded text-sm hover:bg-blue-50 cursor-pointer">
                      <input type="checkbox" checked={selected.has(p.pttype)} onChange={() => toggle(p.pttype)} />
                      <span className="font-mono text-xs text-gray-500 w-7">{p.pttype}</span>
                      <span className="flex-1 text-gray-800">{p.name}</span>
                      {p.visits_90d > 0 && <span className="text-[11px] text-gray-400 tabular-nums">{p.visits_90d.toLocaleString()}</span>}
                    </label>
                  ))}
                </div>
              )
            })}
          </div>
          <div className="flex items-center justify-between px-3 py-2 border-t text-xs text-gray-500">
            <span>ตัวเลขขวา = visit ใน 90 วัน</span>
            <button type="button" onClick={() => onChange('')} className="text-blue-700 hover:underline">ทุกสิทธิ</button>
          </div>
        </div>
      )}
    </div>
  )
}
