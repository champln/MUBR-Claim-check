import { useCallback, useMemo, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Receipt, Upload, FileText, X, Search, Download } from 'lucide-react'
import clsx from 'clsx'
import { previewOpdFeeFix, applyOpdFeeFix, type OpdFeePreviewResult } from '../lib/api'

export default function OpdFeeFixPage() {
  const [files, setFiles] = useState<File[]>([])
  const [preview, setPreview] = useState<OpdFeePreviewResult | null>(null)
  const [codes, setCodes] = useState('')
  const [amount, setAmount] = useState('')

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

  const opts = useMemo(() => ({ codes, amount }), [codes, amount])
  const canRun = files.length > 0

  const previewMutation = useMutation({
    mutationFn: () => previewOpdFeeFix(files, opts),
    onSuccess: (res) => {
      setPreview(res)
      if (res.total_change_count === 0) toast('ไม่พบรายการที่ต้องเติมยอดเบิกในไฟล์นี้', { icon: '✅' })
      else toast.success(`จะเติมยอดเบิก ${res.total_change_count} รายการ`)
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'ตรวจสอบไม่สำเร็จ'),
  })

  const applyMutation = useMutation({
    mutationFn: () => applyOpdFeeFix(files, opts),
    onSuccess: (res) => toast.success(`เติมยอดเบิก ${res.rowsChanged} รายการ — ดาวน์โหลด ${res.filename}`),
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
          <Receipt className="w-5 h-5 text-amber-600" /> เติมยอดเบิกค่าบริการ ผป.นอก (C: T33 / 45)
        </h2>
        <p className="text-sm text-gray-500 mt-0.5">
          เติม <b>จำนวนเงินที่เบิกได้</b> (ฟิลด์ 10) และ <b>จำนวนเงินที่ขอเบิก</b> (ฟิลด์ 11) ใน BillItems แล้วเซ็น Checksum ใหม่
        </p>
        <div className="mt-3 text-xs text-gray-600 bg-amber-50 border border-amber-100 rounded-lg p-3 space-y-1">
          <div>
            แถว <b>"ค่าบริการทั่วไปผู้ป่วยนอก ในเวลาราชการ"</b> (รหัสมาตรฐาน <code>55020</code>)
            ที่ส่งมาโดยมียอดเบิกเป็น <code>0.00</code> ทั้งที่มียอดรายการอยู่ → เติมให้เท่ายอดรายการ
          </div>
          <div className="text-gray-500">
            ระบบดูที่รหัสมาตรฐานของรายการ ไม่ใช่ไล่แก้ทุกแถวที่เป็น 0.00 — รายการอื่นที่ยอดเบิกเป็น 0.00 โดยตั้งใจ (เช่น ค่าธรรมเนียมโรงพยาบาล) จะไม่ถูกแตะ
          </div>
        </div>
      </div>

      {/* 1. ไฟล์ */}
      <div className="card p-5 space-y-3">
        <h3 className="font-semibold text-gray-800 text-sm">1. ไฟล์ส่งเบิก (BILLTRAN .txt หรือ .zip ทั้งชุด)</h3>
        <div {...getRootProps()} className={clsx('border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors',
          isDragActive ? 'border-amber-400 bg-amber-50' : 'border-gray-300 hover:border-gray-400')}>
          <input {...getInputProps()} />
          <Upload className="w-8 h-8 mx-auto text-gray-400 mb-2" />
          <p className="text-sm text-gray-600">ลากวางไฟล์ หรือคลิกเพื่อเลือก (.txt / .zip)</p>
          <p className="text-xs text-gray-400 mt-1">อัปโหลด .zip ทั้งชุดได้ — ระบบแก้เฉพาะ BILLTRAN ไฟล์อื่นคงเดิมทุกไบต์</p>
        </div>
        {files.length > 0 && (
          <ul className="space-y-1.5">
            {files.map(f => (
              <li key={f.name} className="flex items-center gap-2 text-sm bg-gray-50 rounded-lg px-3 py-2">
                <FileText className="w-4 h-4 text-amber-500" />
                <span className="flex-1 truncate">{f.name}</span>
                <span className="text-xs text-gray-400">{(f.size / 1024).toFixed(0)} KB</span>
                <button onClick={() => removeFile(f.name)} className="text-gray-400 hover:text-rose-500"><X className="w-4 h-4" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 2. ตั้งค่า */}
      <div className="card p-5 space-y-3">
        <h3 className="font-semibold text-gray-800 text-sm">2. ตั้งค่า (ปกติไม่ต้องแก้)</h3>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label className="text-[11px] text-gray-500 block mb-1">รหัสรายการที่จะเติม (คั่นด้วยเว้นวรรค/คอมมา)</label>
            <input value={codes} onChange={e => { setCodes(e.target.value); setPreview(null) }}
              placeholder="55020"
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-mono w-64" />
            <p className="text-[11px] text-gray-400 mt-1">ว่าง = ใช้ 55020 (ค่าบริการทั่วไป ในเวลาราชการ)</p>
          </div>
          <div>
            <label className="text-[11px] text-gray-500 block mb-1">ยอดที่จะเติม</label>
            <input value={amount} onChange={e => { setAmount(e.target.value); setPreview(null) }}
              placeholder="ตามยอดของรายการ"
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-mono w-44" />
            <p className="text-[11px] text-gray-400 mt-1">ว่าง = ใช้ยอดของรายการนั้น (ฟิลด์ 9)</p>
          </div>
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
            <span className="text-gray-500 text-xs">รหัสที่ใช้: {preview.codes_used.join(', ')}</span>
            <div className="text-center">
              <div className="font-bold text-amber-600">{preview.total_change_count}</div>
              <div className="text-[10px] text-gray-400">รายการที่จะเติม</div>
            </div>
          </div>
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-white sticky top-0 border-b text-xs text-gray-500 uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">InvNo</th>
                  <th className="px-3 py-2 text-left">วันที่</th>
                  <th className="px-3 py-2 text-left">รายการ</th>
                  <th className="px-3 py-2 text-left">รหัส</th>
                  <th className="px-3 py-2 text-right">ยอดรายการ</th>
                  <th className="px-3 py-2 text-right">เบิกได้</th>
                  <th className="px-3 py-2 text-right">ขอเบิก</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {preview.rows.map((r, i) => (
                  <tr key={i} className="hover:bg-amber-50/30">
                    <td className="px-3 py-2 font-mono">{r.invno}</td>
                    <td className="px-3 py-2 text-gray-500">{r.date}</td>
                    <td className="px-3 py-2 truncate max-w-xs">{r.desc}</td>
                    <td className="px-3 py-2 font-mono text-gray-500">{r.std_code}</td>
                    <td className="px-3 py-2 text-right font-mono">{r.amount}</td>
                    <td className="px-3 py-2 text-right font-mono">
                      <span className="text-gray-400">{r.current_claimable}</span>
                      <span className="text-amber-700 font-semibold"> → {r.new_value}</span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      <span className="text-gray-400">{r.current_requested}</span>
                      <span className="text-amber-700 font-semibold"> → {r.new_value}</span>
                    </td>
                  </tr>
                ))}
                {preview.rows.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">ไม่มีรายการที่ต้องเติม</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
