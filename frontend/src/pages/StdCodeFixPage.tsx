import { useCallback, useMemo, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  Stethoscope, Upload, FileText, X, Search, Download, Trash2, BookMarked, AlertTriangle,
} from 'lucide-react'
import clsx from 'clsx'
import {
  previewStdCodeFix, applyStdCodeFix, listStdCodeLibrary, saveStdCodeLibrary, deleteStdCodeMapping,
  type StdCodePreviewResult,
} from '../lib/api'

export default function StdCodeFixPage() {
  const [files, setFiles] = useState<File[]>([])
  const [preview, setPreview] = useState<StdCodePreviewResult | null>(null)
  const [useFileLearning, setUseFileLearning] = useState(true)
  const [replaceExisting, setReplaceExisting] = useState(false)
  const [saveToLibrary, setSaveToLibrary] = useState(true)
  // รหัสที่ผู้ใช้กรอกสดให้แถวที่ระบบหาไม่ได้ : { local_code: std_code }
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [newRow, setNewRow] = useState({ local_code: '', std_code: '', description: '' })

  const qc = useQueryClient()
  const library = useQuery({ queryKey: ['stdcode-library'], queryFn: listStdCodeLibrary })

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

  const opts = useMemo(
    () => ({ useFileLearning, replaceExisting, overrides, saveToLibrary }),
    [useFileLearning, replaceExisting, overrides, saveToLibrary],
  )
  const canRun = files.length > 0

  const previewMutation = useMutation({
    mutationFn: () => previewStdCodeFix(files, opts),
    onSuccess: (res) => {
      setPreview(res)
      if (res.total_change_count === 0 && res.unresolved_count === 0) {
        toast('ไม่พบปัญหา S19/S41 ในไฟล์นี้', { icon: '✅' })
      } else if (res.total_change_count === 0) {
        toast(`พบ ${res.unresolved_count} แถวที่รหัสว่าง แต่ยังไม่รู้รหัสที่ถูก — กรอกรหัสด้านล่าง`, { icon: '⚠️' })
      } else {
        toast.success(`จะเติม ${res.fill_count} แถว · แก้ ${res.replace_count} แถว`)
      }
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'ตรวจสอบไม่สำเร็จ'),
  })

  const applyMutation = useMutation({
    mutationFn: () => applyStdCodeFix(files, opts),
    onSuccess: (res) => {
      toast.success(`เติม ${res.filled} · แก้ ${res.replaced} แถว — ดาวน์โหลด ${res.filename}`)
      if (res.unresolved > 0) toast(`ยังเหลือ ${res.unresolved} แถวที่หารหัสไม่ได้`, { icon: '⚠️' })
      qc.invalidateQueries({ queryKey: ['stdcode-library'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'แก้ไฟล์ไม่สำเร็จ'),
  })

  const saveMutation = useMutation({
    mutationFn: saveStdCodeLibrary,
    onSuccess: (res) => {
      toast.success(`บันทึกคลังรหัส ${res.saved} รายการ (รวม ${res.total})`)
      setNewRow({ local_code: '', std_code: '', description: '' })
      qc.invalidateQueries({ queryKey: ['stdcode-library'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'บันทึกไม่สำเร็จ'),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteStdCodeMapping,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stdcode-library'] }),
    onError: (e: any) => toast.error(e.response?.data?.detail || 'ลบไม่สำเร็จ'),
  })

  const removeFile = (name: string) => {
    setFiles(prev => prev.filter(f => f.name !== name))
    setPreview(null)
  }

  const setOverride = (local: string, value: string) => {
    setOverrides(prev => ({ ...prev, [local]: value }))
  }

  // เรียนรู้จากไฟล์แล้วเก็บเข้าคลัง (ครั้งเดียวได้ทั้งชุด)
  const learnedNotInLibrary = useMemo(() => {
    if (!preview) return []
    const known = new Set((library.data || []).map(m => m.local_code))
    return Object.entries(preview.learned_map)
      .filter(([local]) => !known.has(local))
      .map(([local_code, std_code]) => ({ local_code, std_code, source: 'LEARNED' }))
  }, [preview, library.data])

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <Stethoscope className="w-5 h-5 text-teal-600" /> แก้รหัสหัตถการ OPServices (S19 / S41)
        </h2>
        <p className="text-sm text-gray-500 mt-0.5">
          เติม/แก้ <code className="text-teal-700">STDCode</code> ในแฟ้ม OPServices แล้วเซ็น Checksum ใหม่
        </p>
        <div className="mt-3 text-xs text-gray-600 bg-teal-50 border border-teal-100 rounded-lg p-3 space-y-1">
          <div><b>S41</b> — Class เป็น <code>OP</code> (หัตถการ) แต่ไม่แจ้งรหัสที่ STDCode → เติมรหัสให้</div>
          <div><b>S19</b> — รหัสการให้บริการไม่ถูกต้อง/ไม่สัมพันธ์กับ CodeSet → แทนที่ด้วยรหัสจากคลังรหัส (ต้องติ๊กเปิด)</div>
          <div className="text-gray-500">
            ระบบหารหัสจาก <b>คลังรหัสหัตถการ</b> ก่อน ถ้าไม่มีจะดูจากแถวอื่นในไฟล์เดียวกันที่ใช้รหัสบริการ (LocalCode) เดียวกัน
          </div>
        </div>
      </div>

      {/* 1. ไฟล์ */}
      <div className="card p-5 space-y-3">
        <h3 className="font-semibold text-gray-800 text-sm">1. ไฟล์ส่งเบิก (OPServices .txt หรือ .zip ทั้งชุด)</h3>
        <div {...getRootProps()} className={clsx('border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors',
          isDragActive ? 'border-teal-400 bg-teal-50' : 'border-gray-300 hover:border-gray-400')}>
          <input {...getInputProps()} />
          <Upload className="w-8 h-8 mx-auto text-gray-400 mb-2" />
          <p className="text-sm text-gray-600">ลากวางไฟล์ หรือคลิกเพื่อเลือก (.txt / .zip)</p>
          <p className="text-xs text-gray-400 mt-1">อัปโหลด .zip ทั้งชุดได้ — ระบบแก้เฉพาะ OPServices ไฟล์อื่นคงเดิมทุกไบต์</p>
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
      </div>

      {/* 2. ตัวเลือก */}
      <div className="card p-5 space-y-2.5">
        <h3 className="font-semibold text-gray-800 text-sm">2. ตัวเลือกการแก้</h3>
        <Check checked={useFileLearning} onChange={setUseFileLearning}
          label="เติมรหัสจากแถวอื่นในไฟล์เดียวกัน (LocalCode เดียวกัน)"
          hint="ใช้เมื่อรายการเดิมมีหลายแถวแต่บางแถวรหัสหลุด — ถ้ารหัสในไฟล์ขัดกันเอง ระบบจะไม่เดา" />
        <Check checked={replaceExisting} onChange={setReplaceExisting}
          label="แก้รหัสที่มีอยู่แล้วให้ตรงคลังรหัส (S19)"
          hint="ปิดไว้ = เติมเฉพาะช่องที่ว่าง ไม่แตะรหัสเดิม" />
        <Check checked={saveToLibrary} onChange={setSaveToLibrary}
          label="จำรหัสที่กรอกเองไว้ในคลัง เพื่อใช้ครั้งต่อไป" />
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => previewMutation.mutate()} disabled={!canRun || previewMutation.isPending} className="btn-secondary">
          <Search className="w-4 h-4" /> {previewMutation.isPending ? 'กำลังตรวจ...' : 'ตรวจสอบก่อนแก้ (Preview)'}
        </button>
        <button onClick={() => applyMutation.mutate()} disabled={!canRun || applyMutation.isPending} className="btn-primary">
          <Download className="w-4 h-4" /> {applyMutation.isPending ? 'กำลังแก้...' : 'แก้ไข & ดาวน์โหลด'}
        </button>
        {!canRun && <span className="text-xs text-gray-400">ต้องอัปโหลดไฟล์ก่อน</span>}
      </div>

      {/* Preview */}
      {preview && (
        <div className="card overflow-hidden">
          <div className="p-4 border-b bg-gray-50 flex flex-wrap items-center gap-5 text-sm">
            <span className="text-gray-600 truncate">{preview.opservices_file}</span>
            <div className="flex gap-5">
              <Stat label="เติม (S41)" value={preview.fill_count} color="text-teal-600" />
              <Stat label="แก้ (S19)" value={preview.replace_count} color="text-amber-600" />
              <Stat label="หารหัสไม่ได้" value={preview.unresolved_count} color={preview.unresolved_count ? 'text-rose-600' : 'text-gray-400'} />
            </div>
          </div>

          {preview.rows.length > 0 && (
            <div className="overflow-x-auto max-h-80 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-white sticky top-0 border-b text-xs text-gray-500 uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left">ปัญหา</th>
                    <th className="px-3 py-2 text-left">InvNo</th>
                    <th className="px-3 py-2 text-left">รหัสบริการ รพ.</th>
                    <th className="px-3 py-2 text-right">ยอด</th>
                    <th className="px-3 py-2 text-left">STDCode เดิม</th>
                    <th className="px-3 py-2 text-left">STDCode ใหม่</th>
                    <th className="px-3 py-2 text-left">ที่มา</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {preview.rows.map((r, i) => (
                    <tr key={i} className="hover:bg-teal-50/30">
                      <td className="px-3 py-2">
                        <span className={clsx('text-xs px-1.5 py-0.5 rounded font-medium',
                          r.issue === 'S41' ? 'bg-teal-100 text-teal-700' : 'bg-amber-100 text-amber-700')}>{r.issue}</span>
                      </td>
                      <td className="px-3 py-2 font-mono">{r.invno}</td>
                      <td className="px-3 py-2 font-mono text-gray-500">{r.local_code}</td>
                      <td className="px-3 py-2 text-right font-mono text-gray-500">{r.amount}</td>
                      <td className="px-3 py-2 font-mono text-gray-400">{r.current_stdcode || '(ว่าง)'}</td>
                      <td className="px-3 py-2 font-mono text-teal-700 font-semibold">→ {r.new_stdcode}</td>
                      <td className="px-3 py-2 text-xs text-gray-500">{r.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* แถวที่หารหัสไม่ได้ — ให้กรอกเอง */}
          {preview.unresolved.length > 0 && (
            <div className="border-t bg-rose-50/40 p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-rose-700">
                <AlertTriangle className="w-4 h-4" />
                {preview.unresolved.length} แถวที่ STDCode ว่างและระบบหารหัสไม่ได้ — กรอกรหัสหัตถการเอง
              </div>
              <div className="space-y-2">
                {Array.from(new Set(preview.unresolved.map(r => r.local_code))).map(local => {
                  const rows = preview.unresolved.filter(r => r.local_code === local)
                  return (
                    <div key={local} className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-mono bg-white border rounded px-2 py-1">{local}</span>
                      <span className="text-xs text-gray-500">({rows.length} แถว · ยอด {rows[0].amount})</span>
                      <span className="text-gray-400">→</span>
                      <input value={overrides[local] || ''} onChange={e => setOverride(local, e.target.value)}
                        placeholder="รหัสหัตถการ เช่น 9503"
                        className="border border-teal-300 rounded-lg px-3 py-1.5 text-sm font-mono w-48 focus:ring-1 focus:ring-teal-400 outline-none" />
                    </div>
                  )
                })}
              </div>
              <p className="text-xs text-gray-500">กรอกแล้วกด "ตรวจสอบก่อนแก้" อีกครั้งเพื่อดูผล</p>
            </div>
          )}

          {learnedNotInLibrary.length > 0 && (
            <div className="border-t p-4 flex flex-wrap items-center gap-3 text-sm">
              <span className="text-gray-600">
                พบรหัสใหม่ {learnedNotInLibrary.length} คู่จากไฟล์นี้ที่ยังไม่มีในคลัง
              </span>
              <button onClick={() => saveMutation.mutate(learnedNotInLibrary)} disabled={saveMutation.isPending}
                className="btn-secondary text-xs py-1.5">
                <BookMarked className="w-3.5 h-3.5" /> เก็บเข้าคลังรหัส
              </button>
            </div>
          )}
        </div>
      )}

      {/* คลังรหัสหัตถการ */}
      <div className="card p-5 space-y-3">
        <h3 className="font-semibold text-gray-800 text-sm flex items-center gap-2">
          <BookMarked className="w-4 h-4 text-teal-600" /> คลังรหัสหัตถการ ({library.data?.length || 0} รายการ)
        </h3>
        <p className="text-xs text-gray-500">รหัสบริการของ รพ. (LocalCode) → รหัสหัตถการมาตรฐาน (STDCode) ใช้เติมอัตโนมัติทุกครั้งที่แก้ไฟล์</p>

        <div className="flex flex-wrap items-end gap-2 bg-gray-50 rounded-lg p-3">
          <Field label="รหัสบริการ รพ." value={newRow.local_code} onChange={v => setNewRow({ ...newRow, local_code: v })} placeholder="3009081" mono />
          <div className="text-gray-400 pb-2">→</div>
          <Field label="STDCode" value={newRow.std_code} onChange={v => setNewRow({ ...newRow, std_code: v })} placeholder="9503" mono />
          <Field label="ชื่อรายการ (ไม่บังคับ)" value={newRow.description} onChange={v => setNewRow({ ...newRow, description: v })} placeholder="ค่าบริการ..." width="w-56" />
          <button
            onClick={() => saveMutation.mutate([{ ...newRow, source: 'MANUAL' }])}
            disabled={!newRow.local_code.trim() || !newRow.std_code.trim() || saveMutation.isPending}
            className="btn-primary text-xs py-2">เพิ่ม/แก้ไข</button>
        </div>

        {library.data && library.data.length > 0 && (
          <div className="overflow-x-auto max-h-72 overflow-y-auto border rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0 border-b text-xs text-gray-500 uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">รหัสบริการ รพ.</th>
                  <th className="px-3 py-2 text-left">STDCode</th>
                  <th className="px-3 py-2 text-left">ชื่อรายการ</th>
                  <th className="px-3 py-2 text-left">ที่มา</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {library.data.map(m => (
                  <tr key={m.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2 font-mono">{m.local_code}</td>
                    <td className="px-3 py-2 font-mono text-teal-700 font-semibold">{m.std_code}</td>
                    <td className="px-3 py-2 text-gray-600 truncate max-w-xs">{m.description}</td>
                    <td className="px-3 py-2 text-xs text-gray-400">{m.source === 'LEARNED' ? 'เรียนรู้จากไฟล์' : 'กรอกเอง'}</td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => deleteMutation.mutate(m.id)} className="text-gray-300 hover:text-rose-500">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value, color = 'text-gray-700' }: { label: string; value: number; color?: string }) {
  return (
    <div className="text-center">
      <div className={clsx('font-bold', color)}>{value}</div>
      <div className="text-[10px] text-gray-400">{label}</div>
    </div>
  )
}

function Check({ checked, onChange, label, hint }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string
}) {
  return (
    <label className="flex items-start gap-2.5 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        className="mt-0.5 w-4 h-4 rounded border-gray-300 text-teal-600 focus:ring-teal-400" />
      <span>
        <span className="text-sm text-gray-700">{label}</span>
        {hint && <span className="block text-xs text-gray-400">{hint}</span>}
      </span>
    </label>
  )
}

function Field({ label, value, onChange, placeholder, mono, width = 'w-40' }: {
  label: string; value: string; onChange: (v: string) => void
  placeholder?: string; mono?: boolean; width?: string
}) {
  return (
    <div>
      <label className="text-[11px] text-gray-500 block mb-1">{label}</label>
      <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className={clsx('border border-gray-300 rounded-lg px-3 py-1.5 text-sm', width, mono && 'font-mono')} />
    </div>
  )
}
