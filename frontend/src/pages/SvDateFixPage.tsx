import { useCallback, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { CalendarClock, Upload, FileText, X, Search, Download, AlertTriangle } from 'lucide-react'
import clsx from 'clsx'
import { previewSvDateFix, applySvDateFix, type SvDatePreviewResult } from '../lib/api'

export default function SvDateFixPage() {
  const [files, setFiles] = useState<File[]>([])
  const [preview, setPreview] = useState<SvDatePreviewResult | null>(null)
  const [forceDate, setForceDate] = useState('')

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

  const canRun = files.length > 0

  const previewMutation = useMutation({
    mutationFn: () => previewSvDateFix(files, forceDate),
    onSuccess: (res) => {
      setPreview(res)
      if (res.total_change_count === 0) toast('วันที่ของทุกรายการตรงกับวัน visit อยู่แล้ว', { icon: '✅' })
      else toast.success(`จะแก้วันที่ ${res.total_change_count} รายการ`)
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'ตรวจสอบไม่สำเร็จ'),
  })

  const applyMutation = useMutation({
    mutationFn: () => applySvDateFix(files, forceDate),
    onSuccess: (res) => toast.success(`แก้วันที่ ${res.rowsChanged} รายการ — ดาวน์โหลด ${res.filename}`),
    onError: (e: any) => toast.error(e.response?.data?.detail || 'แก้ไฟล์ไม่สำเร็จ'),
  })

  const removeFile = (name: string) => {
    setFiles(prev => prev.filter(f => f.name !== name))
    setPreview(null)
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <CalendarClock className="w-5 h-5 text-sky-600" /> แก้วันที่ให้บริการ (C: T42)
        </h2>
        <p className="text-sm text-gray-500 mt-0.5">
          แก้วันที่ของรายการใน <code className="text-sky-700">BillItems</code> (ฟิลด์ที่ 2) ให้ตรงกับวัน visit แล้วเซ็น Checksum ใหม่
        </p>
        <div className="mt-3 text-xs text-gray-600 bg-sky-50 border border-sky-100 rounded-lg p-3 space-y-1">
          <div><b>T42</b> — SVDATE ไม่สัมพันธ์กับ BILLTRAN</div>
          <div className="text-gray-500">
            ระบบอ่านวัน visit จาก BILLTRAN (ฟิลด์ที่ 3) ของแต่ละ Inv.no แล้วแก้เฉพาะรายการที่วันที่ไม่ตรง —
            หาวันที่ที่ถูกต้องเองได้ ไม่ต้องกรอก
          </div>
        </div>
      </div>

      {/* 1. ไฟล์ */}
      <div className="card p-5 space-y-3">
        <h3 className="font-semibold text-gray-800 text-sm">1. ไฟล์ส่งเบิก (BILLTRAN .txt หรือ .zip ทั้งชุด)</h3>
        <div {...getRootProps()} className={clsx('border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors',
          isDragActive ? 'border-sky-400 bg-sky-50' : 'border-gray-300 hover:border-gray-400')}>
          <input {...getInputProps()} />
          <Upload className="w-8 h-8 mx-auto text-gray-400 mb-2" />
          <p className="text-sm text-gray-600">ลากวางไฟล์ หรือคลิกเพื่อเลือก (.txt / .zip)</p>
          <p className="text-xs text-gray-400 mt-1">อัปโหลด .zip ทั้งชุดได้ — ระบบแก้เฉพาะ BILLTRAN ไฟล์อื่นคงเดิมทุกไบต์</p>
        </div>
        {files.length > 0 && (
          <ul className="space-y-1.5">
            {files.map(f => (
              <li key={f.name} className="flex items-center gap-2 text-sm bg-gray-50 rounded-lg px-3 py-2">
                <FileText className="w-4 h-4 text-sky-500" />
                <span className="flex-1 truncate">{f.name}</span>
                <span className="text-xs text-gray-400">{(f.size / 1024).toFixed(0)} KB</span>
                <button onClick={() => removeFile(f.name)} className="text-gray-400 hover:text-rose-500"><X className="w-4 h-4" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 2. ตั้งค่า */}
      <div className="card p-5 space-y-2">
        <h3 className="font-semibold text-gray-800 text-sm">2. ตั้งค่า (ปกติไม่ต้องกรอก)</h3>
        <div>
          <label className="text-[11px] text-gray-500 block mb-1">บังคับใช้วันที่นี้แทนวัน visit</label>
          <input value={forceDate} onChange={e => { setForceDate(e.target.value); setPreview(null) }}
            placeholder="YYYY-MM-DD"
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-mono w-44" />
          <p className="text-[11px] text-gray-400 mt-1">
            ว่าง = ใช้วัน visit จาก BILLTRAN (แนะนำ) · ใช้ช่องนี้เฉพาะกรณีที่วัน visit เองผิด
          </p>
        </div>
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
            <span className="text-gray-600 truncate">{preview.billtran_file}</span>
            <span className="text-xs text-gray-500">
              {Object.keys(preview.visit_dates).length} visit ในไฟล์
            </span>
            <div className="text-center">
              <div className="font-bold text-sky-600">{preview.total_change_count}</div>
              <div className="text-[10px] text-gray-400">รายการที่จะแก้</div>
            </div>
          </div>

          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-white sticky top-0 border-b text-xs text-gray-500 uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">Inv.no</th>
                  <th className="px-3 py-2 text-left">รายการ</th>
                  <th className="px-3 py-2 text-left">รหัส</th>
                  <th className="px-3 py-2 text-right">ยอด</th>
                  <th className="px-3 py-2 text-left">วันที่ในไฟล์</th>
                  <th className="px-3 py-2 text-left">วัน visit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {preview.rows.map((r, i) => (
                  <tr key={i} className="hover:bg-sky-50/30">
                    <td className="px-3 py-2 font-mono">{r.invno}</td>
                    <td className="px-3 py-2 truncate max-w-xs">{r.desc}</td>
                    <td className="px-3 py-2 font-mono text-gray-500">{r.std_code}</td>
                    <td className="px-3 py-2 text-right font-mono text-gray-500">{r.amount}</td>
                    <td className="px-3 py-2 font-mono text-rose-500">{r.current_date}</td>
                    <td className="px-3 py-2 font-mono text-sky-700 font-semibold">→ {r.visit_date}</td>
                  </tr>
                ))}
                {preview.rows.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">ไม่มีรายการที่วันที่ไม่ตรง</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {preview.other_mismatches.length > 0 && (
            <div className="border-t bg-amber-50/50 p-4 text-sm space-y-1">
              <div className="flex items-center gap-2 font-medium text-amber-700">
                <AlertTriangle className="w-4 h-4" />
                แฟ้มอื่นก็มีวันที่ไม่ตรงกับวัน visit {preview.other_mismatches.length} แถว (ระบบไม่แก้ให้)
              </div>
              <p className="text-xs text-gray-600">
                กรณีนี้อาจเป็นวัน visit ใน BILLTRAN เองที่ผิด — ควรตรวจกับ HOSxP ก่อนตัดสินใจ
              </p>
              <ul className="text-xs font-mono text-gray-600 space-y-0.5 pt-1">
                {preview.other_mismatches.slice(0, 10).map((m, i) => (
                  <li key={i}>{m.file} · Inv.no {m.invno} · {m.date} ≠ {m.visit_date}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
