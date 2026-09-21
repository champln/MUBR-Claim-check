import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  ArrowLeft, Download, RotateCcw, Save, Table2, ShieldCheck, ShieldAlert, Lock,
  Maximize2, Minimize2, Search, X, Undo2,
} from 'lucide-react'
import clsx from 'clsx'
import {
  getClaimFileRaw, saveClaimFileRawEdits, resetClaimFileRawEdits, downloadClaimFileRaw,
  type RawEdit, type RawSection,
} from '../lib/api'

type Draft = Record<string, string>   // key = "file|section|row|field"
const key = (f: string, s: string, r: number, c: number) => `${f}|${s}|${r}|${c}`

// ความกว้างคอลัมน์ตามความยาวข้อมูลจริง (px) — ชื่อรายการยาวก็กว้างขึ้น แต่ไม่เกินเพดาน
function columnWidths(sec: RawSection): number[] {
  return sec.labels.map((label, c) => {
    let longest = Math.max(label.length * 0.8, 6)
    for (const row of sec.rows) longest = Math.max(longest, (row[c] || '').length)
    return Math.min(Math.max(Math.round(longest * 8.2) + 26, 96), 360)
  })
}

export default function ClaimFileRawEditPage() {
  const { sessionId } = useParams()
  const id = Number(sessionId)
  const qc = useQueryClient()
  const [draft, setDraft] = useState<Draft>({})
  const [openFile, setOpenFile] = useState<string | null>(null)
  const [openSection, setOpenSection] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [fullscreen, setFullscreen] = useState(false)
  const [active, setActive] = useState<{ r: number; c: number } | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)

  const raw = useQuery({ queryKey: ['claim-file-raw', id], queryFn: () => getClaimFileRaw(id) })

  // Esc ออกจากโหมดเต็มจอ
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && fullscreen && !active) setFullscreen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen, active])

  const pendingEdits: RawEdit[] = useMemo(() =>
    Object.entries(draft).map(([k, value]) => {
      const [file, section, row, field] = k.split('|')
      return { file, section, row: Number(row), field: Number(field), value }
    }), [draft])

  const saveMutation = useMutation({
    mutationFn: () => saveClaimFileRawEdits(id, pendingEdits),
    onSuccess: (res) => {
      toast.success(`บันทึก ${res.saved} ช่อง (รวมที่แก้ไว้ ${res.pending_edits} ช่อง)`)
      setDraft({})
      qc.invalidateQueries({ queryKey: ['claim-file-raw', id] })
      qc.invalidateQueries({ queryKey: ['claim-file-sessions'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'บันทึกไม่สำเร็จ'),
  })

  const resetMutation = useMutation({
    mutationFn: () => resetClaimFileRawEdits(id),
    onSuccess: () => {
      toast.success('ล้างการแก้ไขทั้งหมดแล้ว — กลับไปใช้ไฟล์ต้นฉบับ')
      setDraft({})
      qc.invalidateQueries({ queryKey: ['claim-file-raw', id] })
      qc.invalidateQueries({ queryKey: ['claim-file-sessions'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'ล้างไม่สำเร็จ'),
  })

  const downloadMutation = useMutation({
    mutationFn: () => downloadClaimFileRaw(id),
    onSuccess: (res) => toast.success(
      `เซ็น MD5 ใหม่แล้ว (${res.filesChanged.length} แฟ้ม) — ดาวน์โหลด ${res.filename}`),
    onError: (e: any) => toast.error(e.response?.data?.detail || 'ดาวน์โหลดไม่สำเร็จ'),
  })

  if (raw.isLoading) return <div className="text-sm text-gray-500">กำลังโหลดไฟล์...</div>
  if (raw.isError) {
    const msg = (raw.error as any)?.response?.data?.detail || 'โหลดไฟล์ไม่สำเร็จ'
    return (
      <div className="space-y-4 max-w-2xl">
        <Link to="/claim-files" className="text-sm text-blue-600 inline-flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" /> กลับหน้าตรวจไฟล์
        </Link>
        <div className="card p-5 text-sm text-rose-600">{msg}</div>
      </div>
    )
  }

  const data = raw.data!
  const currentFile = openFile || data.files.find(f => f.editable)?.file || data.files[0]?.file
  const file = data.files.find(f => f.file === currentFile)
  const sec = file?.sections.find(s => s.section === openSection) || file?.sections[0]
  const draftCount = Object.keys(draft).length
  const widths = sec ? columnWidths(sec) : []

  // แถวที่ตรงกับคำค้น (เก็บ index เดิมไว้ เพราะการแก้อ้างอิงลำดับแถวจริง)
  const q = search.trim().toLowerCase()
  const visibleRows = sec
    ? sec.rows.map((row, r) => ({ row, r })).filter(({ row }) => !q || row.some(v => (v || '').toLowerCase().includes(q)))
    : []

  const editedIn = (f: string, s?: string) =>
    Object.keys(draft).filter(k => k.startsWith(`${f}|`) && (!s || k.startsWith(`${f}|${s}|`))).length

  const focusCell = (r: number, c: number) => {
    const el = gridRef.current?.querySelector<HTMLInputElement>(`input[data-r="${r}"][data-c="${c}"]`)
    if (el) { el.focus(); el.select() }
  }

  const onCellKey = (e: React.KeyboardEvent<HTMLInputElement>, pos: number, c: number, original: string, k: string) => {
    const rowsIdx = visibleRows.map(v => v.r)
    if (e.key === 'Enter' || e.key === 'ArrowDown') {
      e.preventDefault()
      const next = rowsIdx[Math.min(pos + (e.shiftKey && e.key === 'Enter' ? -1 : 1), rowsIdx.length - 1)]
      if (next !== undefined) focusCell(next, c)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const prev = rowsIdx[Math.max(pos - 1, 0)]
      if (prev !== undefined) focusCell(prev, c)
    } else if (e.key === 'Escape') {
      // Esc = คืนค่าเดิมของช่องนี้
      e.preventDefault()
      setDraft(d => { const n = { ...d }; delete n[k]; return n })
      ;(e.target as HTMLInputElement).value = original
    }
  }

  const setCell = (k: string, value: string, original: string) => {
    setDraft(d => {
      const n = { ...d }
      if (value === original) delete n[k]   // แก้กลับเป็นค่าเดิม = ไม่นับว่าแก้
      else n[k] = value
      return n
    })
  }

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <button onClick={() => saveMutation.mutate()} disabled={draftCount === 0 || saveMutation.isPending}
        className={clsx('btn-secondary', draftCount > 0 && 'ring-2 ring-amber-300')}>
        <Save className="w-4 h-4" /> บันทึก{draftCount > 0 ? ` (${draftCount})` : ''}
      </button>
      <button onClick={() => downloadMutation.mutate()}
        disabled={data.pending_edits === 0 || draftCount > 0 || downloadMutation.isPending}
        title={draftCount > 0 ? 'บันทึกก่อนดาวน์โหลด' : ''}
        className="btn-primary">
        <Download className="w-4 h-4" /> ดาวน์โหลด + เซ็น MD5 ใหม่
      </button>
      {data.pending_edits > 0 && (
        <button onClick={() => { if (confirm('ล้างการแก้ไขทั้งหมด กลับไปใช้ไฟล์ต้นฉบับ?')) resetMutation.mutate() }}
          className="p-2 text-gray-400 hover:text-rose-500 rounded-lg hover:bg-rose-50" title="ล้างการแก้ไขทั้งหมด">
          <RotateCcw className="w-4 h-4" />
        </button>
      )}
      <button onClick={() => setFullscreen(v => !v)}
        className="p-2 text-gray-500 hover:text-indigo-600 rounded-lg hover:bg-indigo-50 border border-gray-200"
        title={fullscreen ? 'ออกจากเต็มจอ (Esc)' : 'เต็มจอ'}>
        {fullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
      </button>
    </div>
  )

  const body = (
    <div className={clsx('flex flex-col gap-3', fullscreen ? 'h-full' : '')}>
      {/* หัว */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {!fullscreen && (
            <Link to="/claim-files" className="text-sm text-blue-600 inline-flex items-center gap-1 mb-1">
              <ArrowLeft className="w-4 h-4" /> กลับหน้าตรวจไฟล์
            </Link>
          )}
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Table2 className="w-5 h-5 text-indigo-600" /> แก้ไขไฟล์ระดับฟิลด์
            {data.source_filename && <code className="text-xs font-normal text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">{data.source_filename}</code>}
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            คลิกช่องแล้วพิมพ์ได้เลย · <kbd className="kbd">Enter</kbd>/<kbd className="kbd">↓</kbd> ลงแถวถัดไป ·
            {' '}<kbd className="kbd">↑</kbd> ขึ้น · <kbd className="kbd">Tab</kbd> ไปขวา · <kbd className="kbd">Esc</kbd> คืนค่าเดิม
          </p>
        </div>
        {toolbar}
      </div>

      {(data.pending_edits > 0 || draftCount > 0) && (
        <div className="text-sm bg-indigo-50 border border-indigo-100 rounded-lg px-4 py-2 text-indigo-800 flex flex-wrap gap-x-4">
          <span>บันทึกแล้ว <b>{data.pending_edits}</b> ช่อง</span>
          {draftCount > 0 && <span className="text-amber-700">ยังไม่บันทึก <b>{draftCount}</b> ช่อง — กดบันทึกก่อนดาวน์โหลด</span>}
        </div>
      )}

      {/* แท็บไฟล์ */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-gray-200">
        {data.files.map(f => {
          const n = editedIn(f.file)
          return (
            <button key={f.file} onClick={() => { setOpenFile(f.file); setOpenSection(null); setActive(null) }}
              className={clsx('px-3 py-2 text-sm flex items-center gap-1.5 -mb-px border-b-2 transition-colors',
                f.file === currentFile ? 'border-indigo-600 text-indigo-700 font-semibold' : 'border-transparent text-gray-500 hover:text-gray-800')}>
              {f.editable
                ? <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
                : <Lock className="w-3.5 h-3.5 text-gray-400" />}
              {f.file}
              {n > 0 && <span className="text-[10px] bg-amber-100 text-amber-700 rounded-full px-1.5">{n}</span>}
            </button>
          )
        })}
      </div>

      {file && !file.editable && (
        <div className="p-3 text-sm flex items-start gap-2 text-amber-800 bg-amber-50 border border-amber-200 rounded-lg">
          <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{file.reason || 'ไฟล์นี้แก้ไม่ได้'}</span>
        </div>
      )}

      {file && file.sections.length > 0 && sec && (
        <>
          {/* แท็บ section + ค้นหา */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1.5">
              {file.sections.map(s => {
                const n = editedIn(file.file, s.section)
                return (
                  <button key={s.section} onClick={() => { setOpenSection(s.section); setActive(null) }}
                    className={clsx('px-3 py-1 rounded-full text-xs border transition-colors',
                      s.section === sec.section ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 hover:bg-gray-50')}>
                    &lt;{s.section}&gt; <span className="opacity-70">{s.rows.length} แถว</span>
                    {n > 0 && <span className="ml-1 bg-amber-300 text-amber-900 rounded-full px-1.5">{n}</span>}
                  </button>
                )
              })}
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              {file.checksum_ok && <span className="text-emerald-600">✓ Checksum ต้นฉบับถูกต้อง</span>}
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="ค้นหาในตาราง..."
                  className="border border-gray-300 rounded-lg pl-8 pr-7 py-1.5 text-sm w-56 focus:ring-2 focus:ring-indigo-300 outline-none" />
                {search && (
                  <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              {q && <span>{visibleRows.length}/{sec.rows.length} แถว</span>}
            </div>
          </div>

          {/* ตาราง */}
          <div ref={gridRef}
            className={clsx('overflow-auto border border-gray-300 rounded-lg bg-white shadow-sm',
              fullscreen ? 'flex-1 min-h-0' : 'max-h-[calc(100vh-19rem)]')}>
            <table className="border-separate border-spacing-0 text-sm"
              style={{ tableLayout: 'fixed', width: 52 + widths.reduce((a, b) => a + b, 0) }}>
              <colgroup>
                <col style={{ width: 52 }} />
                {widths.map((w, c) => <col key={c} style={{ width: w }} />)}
              </colgroup>
              <thead>
                <tr>
                  <th className="sticky top-0 left-0 z-30 bg-gray-100 border-b border-r border-gray-300 text-[11px] text-gray-500 font-medium">#</th>
                  {sec.labels.map((label, c) => {
                    const named = !label.startsWith('ฟิลด์ ')
                    return (
                      <th key={c}
                        className={clsx('sticky top-0 z-20 border-b border-r border-gray-300 px-2 py-1.5 text-left align-bottom',
                          active?.c === c ? 'bg-indigo-100' : 'bg-gray-100')}>
                        <div className="text-[10px] text-gray-400 font-mono">ฟิลด์ {c + 1}</div>
                        <div className={clsx('text-xs truncate', named ? 'text-gray-800 font-semibold' : 'text-gray-400 font-normal')}
                          title={label}>
                          {named ? label : '—'}
                        </div>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map(({ row, r }, pos) => (
                  <tr key={r} className="group">
                    <td className={clsx('sticky left-0 z-10 border-b border-r border-gray-300 text-center text-[11px] font-mono',
                      active?.r === r ? 'bg-indigo-100 text-indigo-700 font-semibold' : 'bg-gray-50 text-gray-400')}>
                      {r + 1}
                    </td>
                    {row.map((cell, c) => {
                      const k = key(file.file, sec.section, r, c)
                      const edited = draft[k] !== undefined
                      const value = edited ? draft[k] : cell
                      return (
                        <td key={c}
                          className={clsx('border-b border-r border-gray-200 p-0 relative',
                            edited ? 'bg-amber-100' : (active?.r === r ? 'bg-indigo-50/60' : 'group-hover:bg-gray-50'))}>
                          {edited && <span className="absolute top-0 right-0 w-0 h-0 border-t-[7px] border-l-[7px] border-t-amber-500 border-l-transparent" />}
                          <input
                            data-r={r} data-c={c}
                            value={value}
                            readOnly={!file.editable}
                            title={edited ? `ค่าเดิม: ${cell || '(ว่าง)'}` : value}
                            onFocus={() => setActive({ r, c })}
                            onBlur={() => setActive(null)}
                            onChange={e => setCell(k, e.target.value, cell)}
                            onKeyDown={e => onCellKey(e, pos, c, cell, k)}
                            className={clsx(
                              'w-full h-8 px-2 bg-transparent outline-none font-mono text-[13px]',
                              'focus:bg-white focus:ring-2 focus:ring-inset focus:ring-indigo-500 focus:relative focus:z-[5]',
                              edited && 'font-semibold text-amber-900',
                              !file.editable && 'text-gray-400 cursor-not-allowed',
                            )}
                          />
                        </td>
                      )
                    })}
                  </tr>
                ))}
                {visibleRows.length === 0 && (
                  <tr><td colSpan={widths.length + 1} className="px-4 py-8 text-center text-gray-400">ไม่พบแถวที่ตรงกับคำค้น</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-[11px] text-gray-500">
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 bg-amber-100 border border-amber-400 rounded-sm" /> ช่องที่แก้ (ชี้ค้างเพื่อดูค่าเดิม)</span>
            <span className="flex items-center gap-1.5"><span className="font-semibold text-gray-700">ชื่อตัวหนา</span> = ยืนยันความหมายแล้ว</span>
            <span className="flex items-center gap-1.5"><span className="text-gray-400">—</span> = ยังไม่ยืนยันชื่อ ดูเลขฟิลด์แทน</span>
            {draftCount > 0 && (
              <button onClick={() => setDraft({})} className="flex items-center gap-1 text-rose-500 hover:text-rose-600 ml-auto">
                <Undo2 className="w-3.5 h-3.5" /> ยกเลิกที่ยังไม่บันทึกทั้งหมด
              </button>
            )}
          </div>
        </>
      )}

      {file?.editable && file.sections.length === 0 && (
        <div className="card p-6 text-center text-sm text-gray-400">ไม่พบ section ที่รองรับในไฟล์นี้</div>
      )}
    </div>
  )

  return fullscreen
    ? <div className="fixed inset-0 z-50 bg-gray-50 p-4 flex flex-col">{body}</div>
    : body
}
