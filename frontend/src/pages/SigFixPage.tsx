import { useCallback, useMemo, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { NotebookPen, Upload, FileText, X, Search, Download, Trash2, Library } from 'lucide-react'
import clsx from 'clsx'
import {
  previewSigFix, applySigFix, listSigLibrary, deleteSigMapping,
  type SigPreviewResult, type SigRow, type SigOverride,
} from '../lib/api'

// แถวที่ใช้รหัสวิธีใช้เดียวกัน (หรือยาตัวเดียวกันเมื่อไม่มีรหัสวิธีใช้) ใช้ข้อความเดียวกัน
function keyOf(r: SigRow): { key_type: 'SIG' | 'DRUG'; key: string } {
  return r.has_sig_code ? { key_type: 'SIG', key: r.sig_code } : { key_type: 'DRUG', key: r.drug_code }
}
const idOf = (k: { key_type: string; key: string }) => `${k.key_type}:${k.key}`
const BAD_CHARS = /[|\r\n&<>]/

// ไฮไลต์อักขระต้องห้ามในข้อความเดิม
function markChars(text: string) {
  return text.split(/([&<>])/).map((part, i) =>
    /^[&<>]$/.test(part)
      ? <mark key={i} className="bg-rose-200 text-rose-800 rounded px-0.5 font-bold">{part}</mark>
      : <span key={i}>{part}</span>)
}

export default function SigFixPage() {
  const qc = useQueryClient()
  const [files, setFiles] = useState<File[]>([])
  const [preview, setPreview] = useState<SigPreviewResult | null>(null)
  const [texts, setTexts] = useState<Record<string, string>>({})
  const [rowTexts, setRowTexts] = useState<Record<number, string>>({})
  const [saveToLibrary, setSaveToLibrary] = useState(true)

  const library = useQuery({ queryKey: ['sig-library'], queryFn: listSigLibrary })

  const onDrop = useCallback((accepted: File[]) => {
    setFiles(prev => {
      const names = new Set(prev.map(f => f.name))
      return [...prev, ...accepted.filter(f => !names.has(f.name))]
    })
    setPreview(null)
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'text/plain': ['.txt'], 'application/zip': ['.zip'], 'application/x-zip-compressed': ['.zip'] },
  })

  // กลุ่มแถวตามคีย์ — กรอกครั้งเดียวต่อรหัสวิธีใช้/ยา
  const groups = useMemo(() => {
    const m = new Map<string, { key_type: 'SIG' | 'DRUG'; key: string; rows: SigRow[] }>()
    for (const r of (preview?.rows || []).filter(x => x.issue === 'EMPTY')) {
      const k = keyOf(r)
      const id = idOf(k)
      if (!m.has(id)) m.set(id, { ...k, rows: [] })
      m.get(id)!.rows.push(r)
    }
    return [...m.entries()]
  }, [preview])

  const overrides: SigOverride[] = groups
    .map(([id, g]) => ({
      key_type: g.key_type, key: g.key, sig_text: (texts[id] || '').trim(),
      description: g.rows[0]?.drug_name,
    }))
    .filter(o => o.sig_text)

  const charRows = (preview?.rows || []).filter(r => r.issue === 'CHARS')
  const invalid = overrides.some(o => BAD_CHARS.test(o.sig_text))
    || charRows.some(r => BAD_CHARS.test(rowTexts[r.row] ?? ''))
  const missing = groups.filter(([id, g]) => !(texts[id] || '').trim() && !g.rows[0].new_sig_text).length
  const charMissing = charRows.filter(r => !(rowTexts[r.row] ?? '').trim()).length
  const nothingToDo = missing === groups.length && charMissing === charRows.length

  const previewMutation = useMutation({
    mutationFn: () => previewSigFix(files, overrides),
    onSuccess: (res) => {
      setPreview(res)
      // เติมช่องกรอกด้วยข้อความจากคลัง (ถ้ามี) ให้ผู้ใช้เห็นและแก้ได้
      setTexts(prev => {
        const next = { ...prev }
        for (const r of res.rows) {
          const id = idOf(keyOf(r))
          if (!next[id] && r.new_sig_text) next[id] = r.new_sig_text
        }
        return next
      })
      setRowTexts(Object.fromEntries(res.rows.filter(r => r.issue === 'CHARS').map(r => [r.row, r.new_sig_text])))
      if (res.total_count === 0) toast('วิธีใช้ยาครบและไม่มีอักขระต้องห้าม', { icon: '✅' })
      else toast.success(`พบปัญหาวิธีใช้ยา ${res.total_count} รายการ`)
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'ตรวจสอบไม่สำเร็จ'),
  })

  const applyMutation = useMutation({
    mutationFn: () => applySigFix(files, overrides, saveToLibrary, rowTexts),
    onSuccess: (res) => {
      toast.success(`เติมวิธีใช้ ${res.filled} · แก้อักขระ ${res.cleaned} รายการ — ดาวน์โหลด ${res.filename}`)
      if (res.unresolved) toast(`ยังขาดวิธีใช้อีก ${res.unresolved} รายการ`, { icon: '⚠️' })
      if (saveToLibrary) qc.invalidateQueries({ queryKey: ['sig-library'] })
    },
    onError: async (e: any) => {
      // คำตอบเป็น blob — อ่านข้อความ error ออกมาแสดง
      let msg = 'แก้ไฟล์ไม่สำเร็จ'
      try { msg = JSON.parse(await e.response.data.text()).detail || msg } catch { /* ignore */ }
      toast.error(msg)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteSigMapping,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sig-library'] }),
    onError: () => toast.error('ลบไม่สำเร็จ'),
  })

  const removeFile = (name: string) => {
    setFiles(prev => prev.filter(f => f.name !== name))
    setPreview(null)
  }

  const canRun = files.length > 0

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <NotebookPen className="w-5 h-5 text-teal-600" /> เติมวิธีการใช้ยา (C: R24)
        </h2>
        <p className="text-sm text-gray-500 mt-0.5">
          เติมข้อความวิธีใช้ (<code className="text-teal-700">sigText</code>, ฟิลด์ที่ 9) ของยาใน
          <code className="text-teal-700"> BILLDISP → DispensedItems</code> ที่ว่างอยู่ แล้วเซ็น Checksum ใหม่
        </p>
        <div className="mt-3 text-xs text-gray-600 bg-teal-50 border border-teal-100 rounded-lg p-3 space-y-1">
          <div><b>R24</b> — ขาดวิธีการใช้ยา</div>
          <div className="text-gray-500">
            มักเกิดเพราะแพทย์เลือกวิธีใช้แล้ว แต่รหัสวิธีใช้นั้นใน HOSxP ไม่มีข้อความผูกไว้ ไฟล์จึงออกมาว่าง —
            ระบบตรวจเฉพาะ <b>ยา</b> (PrdCat = 1) เวชภัณฑ์ที่ไม่มีวิธีใช้ถือว่าปกติ
          </div>
          <div className="text-gray-500">
            ข้อความวิธีใช้ต้องมาจากคำสั่งแพทย์ — ระบบไม่แต่งให้เอง กรอกครั้งเดียวแล้วบันทึกเข้าคลังไว้ใช้ครั้งหน้า
            และควรแจ้ง IT ให้เติมข้อความของรหัสวิธีใช้นั้นใน HOSxP เพื่อตัดต้นเหตุ
          </div>
          <div className="text-gray-500">
            อีกสาเหตุที่ติด R24 ซ้ำ/ไฟล์ไม่ผ่าน คือวิธีใช้ที่หมอพิมพ์เองมีอักขระ <b>&amp; &lt; &gt;</b> —
            ระบบเสนอข้อความที่แทนเป็นคำให้ (เช่น &lt;ถ้าปวด&gt; → (ถ้าปวด), BP&gt;140 → BP มากกว่า 140) ตรวจทานแล้วแก้ได้ก่อนกด
          </div>
        </div>
      </div>

      {/* 1. ไฟล์ */}
      <div className="card p-5 space-y-3">
        <h3 className="font-semibold text-gray-800 text-sm">1. ไฟล์ส่งเบิก (BILLDISP .txt หรือ .zip ทั้งชุด)</h3>
        <div {...getRootProps()} className={clsx('border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors',
          isDragActive ? 'border-teal-400 bg-teal-50' : 'border-gray-300 hover:border-gray-400')}>
          <input {...getInputProps()} />
          <Upload className="w-8 h-8 mx-auto text-gray-400 mb-2" />
          <p className="text-sm text-gray-600">ลากวางไฟล์ หรือคลิกเพื่อเลือก (.txt / .zip)</p>
          <p className="text-xs text-gray-400 mt-1">อัปโหลด .zip ทั้งชุดได้ — ระบบแก้เฉพาะ BILLDISP ไฟล์อื่นคงเดิมทุกไบต์</p>
        </div>
        {files.length > 0 && (
          <ul className="space-y-1.5">
            {files.map(f => (
              <li key={f.name} className="flex items-center gap-2 text-sm bg-gray-50 rounded-lg px-3 py-2">
                <FileText className="w-4 h-4 text-teal-500" />
                <span className="flex-1 truncate">{f.name}</span>
                <span className="text-xs text-gray-400">{(f.size / 1024).toFixed(0)} KB</span>
                <button onClick={() => removeFile(f.name)} className="text-gray-400 hover:text-rose-500"><X className="w-4 h-4" /></button>
              </li>
            ))}
          </ul>
        )}
        <button onClick={() => previewMutation.mutate()} disabled={!canRun || previewMutation.isPending} className="btn-secondary">
          <Search className="w-4 h-4" /> {previewMutation.isPending ? 'กำลังตรวจ...' : 'ตรวจวิธีใช้ยา'}
        </button>
      </div>

      {/* 2. กรอกวิธีใช้ */}
      {preview && (
        <div className="card overflow-hidden">
          <div className="p-4 border-b bg-gray-50 flex flex-wrap items-center gap-5 text-sm">
            <span className="text-gray-600 truncate">{preview.billdisp_file}</span>
            <div className="text-center">
              <div className="font-bold text-teal-600">{preview.empty_count}</div>
              <div className="text-[12px] text-gray-400">ยาที่ขาดวิธีใช้</div>
            </div>
            <div className="text-center">
              <div className="font-bold text-rose-600">{preview.chars_count}</div>
              <div className="text-[12px] text-gray-400">มีอักขระ &amp; &lt; &gt;</div>
            </div>
            <div className="text-center">
              <div className="font-bold text-gray-700">{preview.fillable_count}</div>
              <div className="text-[12px] text-gray-400">มีในคลังแล้ว</div>
            </div>
          </div>

          {charRows.length > 0 && (
            <div className="divide-y divide-gray-100 border-b">
              <div className="px-4 py-2 bg-rose-50/60 text-xs font-medium text-rose-700">
                วิธีใช้ที่มีอักขระ &amp; &lt; &gt; — ตรวจทานข้อความใหม่ก่อนกดแก้
              </div>
              {charRows.map(r => {
                const val = rowTexts[r.row] ?? ''
                const bad = BAD_CHARS.test(val)
                return (
                  <div key={r.row} className="p-4 space-y-2">
                    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
                      <span className="font-medium text-gray-800">{r.drug_name || '(ไม่มีชื่อ)'}</span>
                      <span className="font-mono text-xs text-gray-500">รหัสยา {r.drug_code}</span>
                      <span className="text-[12px] rounded-full px-2 bg-rose-100 text-rose-700">{r.kind}</span>
                    </div>
                    <div className="text-sm text-gray-600">
                      <span className="text-xs text-gray-400 mr-2">เดิม</span>{markChars(r.current_sig_text)}
                    </div>
                    <input
                      value={val}
                      onChange={e => setRowTexts(t => ({ ...t, [r.row]: e.target.value }))}
                      className={clsx('w-full border rounded-lg px-3 py-2 text-sm',
                        bad ? 'border-rose-400 bg-rose-50' : 'border-gray-300')}
                    />
                    {bad && <div className="text-[12px] text-rose-600">ยังมีอักขระ | &amp; &lt; &gt; หรือขึ้นบรรทัดใหม่</div>}
                  </div>
                )
              })}
            </div>
          )}

          {groups.length === 0 ? (
            charRows.length === 0 && <div className="px-4 py-8 text-center text-gray-400 text-sm">ไม่พบปัญหาวิธีใช้ยา</div>
          ) : (
            <div className="divide-y divide-gray-100">
              {groups.map(([id, g]) => {
                const val = texts[id] || ''
                const bad = BAD_CHARS.test(val)
                return (
                  <div key={id} className="p-4 space-y-2">
                    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
                      <span className="font-medium text-gray-800">{g.rows[0].drug_name || '(ไม่มีชื่อยา)'}</span>
                      <span className="font-mono text-xs text-gray-500">รหัสยา {g.rows[0].drug_code}</span>
                      <span className="font-mono text-xs text-gray-500">รหัสวิธีใช้ {g.rows[0].sig_code || '-'}</span>
                      <span className={clsx('text-[12px] rounded-full px-2',
                        g.key_type === 'SIG' ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700')}>
                        {g.rows[0].kind}
                      </span>
                      <span className="text-xs text-gray-400">{g.rows.length} รายการ</span>
                    </div>
                    <input
                      value={val}
                      onChange={e => setTexts(t => ({ ...t, [id]: e.target.value }))}
                      placeholder="พิมพ์วิธีใช้ตามคำสั่งแพทย์ เช่น ใช้ฉีดเฉพาะที่ ก่อนทำหัตถการ"
                      className={clsx('w-full border rounded-lg px-3 py-2 text-sm',
                        bad ? 'border-rose-400 bg-rose-50' : 'border-gray-300')}
                    />
                    <div className="text-[12px] text-gray-400">
                      {bad ? <span className="text-rose-600">ห้ามมีเครื่องหมาย | &amp; &lt; &gt; หรือขึ้นบรรทัดใหม่</span>
                        : g.key_type === 'SIG'
                          ? <>ข้อความนี้จะใช้กับทุกรายการที่ใช้รหัสวิธีใช้ <span className="font-mono">{g.key}</span></>
                          : <>ไม่มีรหัสวิธีใช้ — จำตามรหัสยา <span className="font-mono">{g.key}</span></>}
                      {g.rows[0].source && !bad && <> · มาจาก{g.rows[0].source}</>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {(groups.length > 0 || charRows.length > 0) && (
            <div className="p-4 border-t bg-gray-50 flex flex-wrap items-center gap-4">
              {groups.length > 0 && <label className="flex items-center gap-2 text-sm text-gray-600">
                <input type="checkbox" checked={saveToLibrary} onChange={e => setSaveToLibrary(e.target.checked)} />
                บันทึกวิธีใช้ที่กรอกเข้าคลัง (ครั้งหน้าเติมให้อัตโนมัติ)
              </label>}
              <button onClick={() => applyMutation.mutate()}
                disabled={applyMutation.isPending || invalid || nothingToDo}
                className="btn-primary ml-auto">
                <Download className="w-4 h-4" /> {applyMutation.isPending ? 'กำลังแก้...' : 'แก้วิธีใช้ & ดาวน์โหลด'}
              </button>
              {missing + charMissing > 0 && !nothingToDo && (
                <span className="text-xs text-amber-600 w-full text-right">
                  ยังไม่ได้กรอก {missing + charMissing} รายการ — จะแก้เฉพาะที่กรอกแล้ว
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* คลังวิธีใช้ */}
      <div className="card p-5 space-y-3">
        <h3 className="font-semibold text-gray-800 text-sm flex items-center gap-2">
          <Library className="w-4 h-4 text-teal-600" /> คลังวิธีการใช้ยา
          <span className="text-xs font-normal text-gray-400">{library.data?.length ?? 0} รายการ</span>
        </h3>
        {library.data && library.data.length > 0 ? (
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-500 border-b">
              <tr>
                <th className="py-2 text-left">จำตาม</th>
                <th className="py-2 text-left">รหัส</th>
                <th className="py-2 text-left">ยา</th>
                <th className="py-2 text-left">วิธีใช้</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {library.data.map(m => (
                <tr key={m.id}>
                  <td className="py-2 text-xs text-gray-500">{m.key_type === 'SIG' ? 'รหัสวิธีใช้' : 'รหัสยา'}</td>
                  <td className="py-2 font-mono text-xs">{m.key}</td>
                  <td className="py-2 text-gray-600 truncate max-w-[14rem]">{m.description}</td>
                  <td className="py-2">{m.sig_text}</td>
                  <td className="py-2 text-right">
                    <button onClick={() => { if (confirm(`ลบวิธีใช้ของ ${m.key}?`)) deleteMutation.mutate(m.id) }}
                      className="text-gray-400 hover:text-rose-500"><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-gray-400">ยังไม่มีรายการ — กรอกวิธีใช้ตอนแก้ไฟล์แล้วติ๊ก "บันทึกเข้าคลัง"</p>
        )}
      </div>
    </div>
  )
}
