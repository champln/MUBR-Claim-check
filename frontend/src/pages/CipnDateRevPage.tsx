import { useCallback, useMemo, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  CalendarCheck, Upload, FileText, X, Search, Download, AlertTriangle, Lock, Wand2,
} from 'lucide-react'
import clsx from 'clsx'
import { previewDateRev, applyDateRev, type DateRevPreview } from '../lib/api'

export default function CipnDateRevPage() {
  const [files, setFiles] = useState<File[]>([])
  const [preview, setPreview] = useState<DateRevPreview | null>(null)
  const [rules, setRules] = useState<Record<string, string>>({})   // รหัสรายการ -> วันที่ใหม่
  const [onlySuspect, setOnlySuspect] = useState(true)
  const [bulkDate, setBulkDate] = useState('')

  const onDrop = useCallback((accepted: File[]) => {
    setFiles(accepted.slice(0, 1))
    setPreview(null)
    setRules({})
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/xml': ['.xml'], 'application/xml': ['.xml'],
      'application/zip': ['.zip'], 'application/x-zip-compressed': ['.zip'],
    },
    maxFiles: 1,
  })

  const ruleCount = useMemo(() => Object.values(rules).filter(v => v.trim()).length, [rules])
  const canRun = files.length > 0

  const previewMutation = useMutation({
    mutationFn: () => previewDateRev(files, rules),
    onSuccess: (res) => {
      setPreview(res)
      if (res.suspect_count === 0) toast('ไม่พบรายการที่ DateRev เป็นวันที่ส่งออกไฟล์', { icon: '✅' })
      else toast(`พบ ${res.suspect_count} รายการที่ DateRev น่าจะไม่ถูกต้อง`, { icon: '⚠️' })
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'ตรวจสอบไม่สำเร็จ'),
  })

  const applyMutation = useMutation({
    mutationFn: () => applyDateRev(files, rules),
    onSuccess: (res) => toast.success(`แก้ DateRev แล้ว — ดาวน์โหลด ${res.filename}`),
    onError: (e: any) => toast.error(e.response?.data?.detail || 'แก้ไฟล์ไม่สำเร็จ'),
  })

  const setRule = (code: string, value: string) => {
    setRules(prev => ({ ...prev, [code]: value }))
  }

  const rows = preview
    ? preview.rows.filter(r => !onlySuspect || r.suspect || rules[r.lccode])
    : []

  const applyBulk = () => {
    if (!bulkDate.trim() || !preview) return
    const next = { ...rules }
    preview.rows.filter(r => r.suspect).forEach(r => { next[r.lccode] = bulkDate.trim() })
    setRules(next)
    toast.success(`ใส่วันที่ ${bulkDate.trim()} ให้ ${preview.suspect_count} รายการที่น่าสงสัย`)
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <CalendarCheck className="w-5 h-5 text-rose-600" /> แก้วันที่ปรับปรุงล่าสุด (DateRev) — ผู้ป่วยใน
        </h2>
        <p className="text-sm text-gray-500 mt-0.5">
          แก้ <code className="text-rose-700">DateRev</code> (ฟิลด์ที่ 18 ของ BillItems) ในไฟล์ CIPN/AIPN แล้วเซ็นลายเซ็นท้ายไฟล์ใหม่
        </p>
        <div className="mt-3 text-xs text-gray-600 bg-rose-50 border border-rose-100 rounded-lg p-3 space-y-1">
          <div>
            รายการที่ยังไม่เคยตั้งวันที่ปรับปรุงใน HOSxP จะถูก export ออกมาเป็น <b>วันที่ส่งออกไฟล์</b> แทนวันที่จริง
            (เช่น ควรเป็น 2005-02-10 แต่ได้ 2026-09-24)
          </div>
          <div className="text-gray-500">
            ระบบจะชี้ให้ว่าแถวไหนน่าสงสัย (DateRev ว่าง หรือตรงกับวันที่ส่งออก) แล้วให้กรอกวันที่ที่ถูกต้องเป็นรายรหัส
            — ทางที่ยั่งยืนกว่าคือแก้ที่ HOSxP ให้ถูกแล้ว export ใหม่ ส่วนหน้านี้ไว้แก้ไฟล์ที่ออกมาแล้ว
          </div>
        </div>
      </div>

      {/* 1. ไฟล์ */}
      <div className="card p-5 space-y-3">
        <h3 className="font-semibold text-gray-800 text-sm">1. ไฟล์ผู้ป่วยใน (CIPN/AIPN .xml หรือ .zip)</h3>
        <div {...getRootProps()} className={clsx('border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors',
          isDragActive ? 'border-rose-400 bg-rose-50' : 'border-gray-300 hover:border-gray-400')}>
          <input {...getInputProps()} />
          <Upload className="w-8 h-8 mx-auto text-gray-400 mb-2" />
          <p className="text-sm text-gray-600">ลากวางไฟล์ หรือคลิกเพื่อเลือก (ครั้งละ 1 ไฟล์)</p>
        </div>
        {files.map(f => (
          <div key={f.name} className="flex items-center gap-2 text-sm bg-gray-50 rounded-lg px-3 py-2">
            <FileText className="w-4 h-4 text-rose-500" />
            <span className="flex-1 truncate">{f.name}</span>
            <span className="text-xs text-gray-400">{(f.size / 1024).toFixed(0)} KB</span>
            <button onClick={() => { setFiles([]); setPreview(null); setRules({}) }}
              className="text-gray-400 hover:text-rose-500"><X className="w-4 h-4" /></button>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => previewMutation.mutate()} disabled={!canRun || previewMutation.isPending} className="btn-secondary">
          <Search className="w-4 h-4" /> {previewMutation.isPending ? 'กำลังตรวจ...' : 'ตรวจสอบไฟล์'}
        </button>
        <button onClick={() => applyMutation.mutate()}
          disabled={!canRun || ruleCount === 0 || applyMutation.isPending || (preview ? !preview.can_sign : false)}
          className="btn-primary">
          <Download className="w-4 h-4" /> {applyMutation.isPending ? 'กำลังแก้...' : `แก้ไข & ดาวน์โหลด${ruleCount ? ` (${ruleCount})` : ''}`}
        </button>
        {preview && !preview.can_sign && (
          <span className="text-xs text-amber-700 flex items-center gap-1.5">
            <Lock className="w-3.5 h-3.5" /> {preview.sign_note}
          </span>
        )}
      </div>

      {/* Preview */}
      {preview && (
        <div className="card overflow-hidden">
          <div className="p-4 border-b bg-gray-50 flex flex-wrap items-center gap-5 text-sm">
            <span className="text-gray-600 truncate">{preview.file}</span>
            <span className="text-xs text-gray-500">วันที่ส่งออกไฟล์ <b className="font-mono">{preview.export_date}</b></span>
            <div className="flex gap-5">
              <Stat label="รายการทั้งหมด" value={preview.total_rows} />
              <Stat label="น่าสงสัย" value={preview.suspect_count} color={preview.suspect_count ? 'text-rose-600' : 'text-gray-400'} />
              <Stat label="จะแก้" value={ruleCount} color="text-emerald-600" />
            </div>
            <label className="text-xs text-gray-600 flex items-center gap-1.5 ml-auto cursor-pointer">
              <input type="checkbox" checked={onlySuspect} onChange={e => setOnlySuspect(e.target.checked)}
                className="w-3.5 h-3.5 rounded border-gray-300 text-rose-600" />
              แสดงเฉพาะที่น่าสงสัย
            </label>
          </div>

          {preview.suspect_count > 0 && (
            <div className="px-4 py-2.5 bg-rose-50/60 border-b flex flex-wrap items-center gap-2 text-sm">
              <Wand2 className="w-4 h-4 text-rose-600" />
              <span className="text-gray-700">ใส่วันที่เดียวกันให้ทุกแถวที่น่าสงสัย:</span>
              <input value={bulkDate} onChange={e => setBulkDate(e.target.value)} placeholder="YYYY-MM-DD"
                className="border border-gray-300 rounded-lg px-3 py-1 text-sm font-mono w-40" />
              <button onClick={applyBulk} disabled={!bulkDate.trim()} className="btn-secondary text-xs py-1">ใส่ให้ทั้งหมด</button>
            </div>
          )}

          <div className="overflow-x-auto max-h-[32rem] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-white sticky top-0 border-b text-xs text-gray-500 uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">ลำดับ</th>
                  <th className="px-3 py-2 text-left">รหัสรายการ</th>
                  <th className="px-3 py-2 text-left">ชื่อรายการ</th>
                  <th className="px-3 py-2 text-left">วันที่ให้บริการ</th>
                  <th className="px-3 py-2 text-left">DateRev ปัจจุบัน</th>
                  <th className="px-3 py-2 text-left">แก้เป็น</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((r, i) => (
                  <tr key={i} className={clsx(r.suspect && 'bg-rose-50/40')}>
                    <td className="px-3 py-2 font-mono text-gray-500">{r.seq}</td>
                    <td className="px-3 py-2 font-mono">{r.lccode}</td>
                    <td className="px-3 py-2 truncate max-w-md">{r.desc}</td>
                    <td className="px-3 py-2 font-mono text-gray-500">{r.svdate.slice(0, 10)}</td>
                    <td className="px-3 py-2 font-mono">
                      {r.suspect && <AlertTriangle className="w-3.5 h-3.5 text-rose-500 inline mr-1 -mt-0.5" />}
                      <span className={clsx(r.suspect ? 'text-rose-600 font-semibold' : 'text-gray-600')}>
                        {r.current_daterev || '(ว่าง)'}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <input value={rules[r.lccode] || ''} onChange={e => setRule(r.lccode, e.target.value)}
                        placeholder="YYYY-MM-DD"
                        className="border border-gray-300 rounded px-2 py-1 text-sm font-mono w-36 focus:ring-1 focus:ring-rose-400 outline-none" />
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                    {onlySuspect ? 'ไม่มีรายการที่น่าสงสัย' : 'ไม่มีรายการ'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 text-[11px] text-gray-500 border-t">
            แก้เป็นรายรหัส — ถ้าในไฟล์มีรายการรหัสเดียวกันหลายแถว จะถูกแก้ให้เหมือนกันทุกแถว
          </div>
        </div>
      )}
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
