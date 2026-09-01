import { useCallback, useMemo, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  Biohazard, Upload, FileText, FileSpreadsheet, X, Search, Download,
  CheckCircle2, AlertTriangle, ShieldCheck,
} from 'lucide-react'
import clsx from 'clsx'
import {
  previewCovid19, applyCovid19,
  type Covid19PreviewResult,
} from '../lib/api'

export default function Covid19FixPage() {
  const [txtFiles, setTxtFiles] = useState<File[]>([])
  const [listFile, setListFile] = useState<File | null>(null)
  const [manualInvnos, setManualInvnos] = useState('')
  const [manualHns, setManualHns] = useState('')
  const [preview, setPreview] = useState<Covid19PreviewResult | null>(null)
  const [showOnlyMatched, setShowOnlyMatched] = useState(true)

  const onDropTxt = useCallback((accepted: File[]) => {
    // เก็บเฉพาะ .txt/.zip ที่ชื่อมี BILLTRAN (หรือ zip)
    setTxtFiles(prev => {
      const names = new Set(prev.map(f => f.name))
      return [...prev, ...accepted.filter(f => !names.has(f.name))]
    })
    setPreview(null)
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: onDropTxt,
    accept: { 'text/plain': ['.txt'], 'application/zip': ['.zip'], 'application/x-zip-compressed': ['.zip'] },
  })

  const hasTargets = !!listFile || manualInvnos.trim() !== '' || manualHns.trim() !== ''
  const canRun = txtFiles.length > 0 && hasTargets
  const hasFile = txtFiles.length > 0

  const makeOpts = useCallback((applyAll: boolean) => ({
    listFile,
    manualInvnos: manualInvnos.trim() || undefined,
    manualHns: manualHns.trim() || undefined,
    applyAll,
  }), [listFile, manualInvnos, manualHns])

  const previewMutation = useMutation({
    mutationFn: (applyAll: boolean) => previewCovid19(txtFiles, makeOpts(applyAll)),
    onSuccess: (res) => {
      setPreview(res)
      if (res.match_count === 0) toast('ไม่พบ InvNo/HN ที่ตรงในไฟล์ BILLTRAN', { icon: '⚠️' })
      else if (res.apply_all) toast.success(`เติมทุก VN: ${res.match_count} รายการ · จะเปลี่ยน ${res.will_change_count}`)
      else toast.success(`พบ ${res.match_count} รายการ · จะเปลี่ยน ${res.will_change_count} รายการ`)
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'ตรวจสอบไม่สำเร็จ'),
  })

  const applyMutation = useMutation({
    mutationFn: (applyAll: boolean) => applyCovid19(txtFiles, makeOpts(applyAll)),
    onSuccess: (res) => {
      toast.success(`แก้ไข ${res.changed} รายการ · ดาวน์โหลด ${res.filename} แล้ว`)
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'แก้ไฟล์ไม่สำเร็จ'),
  })

  const handleApplyAll = () => {
    if (!window.confirm('ยืนยันเติม AuthCode = COV-19 ให้ "ทุก VN" ในไฟล์นี้?\nทุกรายการที่ยังไม่มี COV-19 จะถูกเติมทั้งหมด')) return
    applyMutation.mutate(true)
  }

  const removeTxt = (name: string) => {
    setTxtFiles(prev => prev.filter(f => f.name !== name))
    setPreview(null)
  }

  const visibleRows = useMemo(() => {
    if (!preview) return []
    return showOnlyMatched ? preview.rows.filter(r => r.matched) : preview.rows
  }, [preview, showOnlyMatched])

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <Biohazard className="w-5 h-5 text-rose-600" /> แก้ไฟล์ระบุ COVID-19 (AuthCode = COV-19)
        </h2>
        <p className="text-sm text-gray-500 mt-0.5">
          เติม AuthCode = <code className="text-rose-700 font-mono">COV-19</code> ใน BILLTRAN ตาม InvNo/HN ที่กำหนด แล้วเซ็น Checksum (MD5) ใหม่ ส่ง สกส. ได้ทันที
        </p>
      </div>

      {/* 1. ไฟล์ BILLTRAN */}
      <div className="card p-5 space-y-3">
        <h3 className="font-semibold text-gray-800 text-sm">1. ไฟล์ส่งเบิก (BILLTRAN.txt หรือ .zip)</h3>
        <div
          {...getRootProps()}
          className={clsx(
            'border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors',
            isDragActive ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-gray-400',
          )}
        >
          <input {...getInputProps()} />
          <Upload className="w-8 h-8 mx-auto text-gray-400 mb-2" />
          <p className="text-sm text-gray-600">ลากวางไฟล์ หรือคลิกเพื่อเลือก (.txt / .zip)</p>
        </div>
        {txtFiles.length > 0 && (
          <ul className="space-y-1.5">
            {txtFiles.map(f => (
              <li key={f.name} className="flex items-center gap-2 text-sm bg-gray-50 rounded-lg px-3 py-2">
                <FileText className="w-4 h-4 text-blue-500" />
                <span className="flex-1 truncate">{f.name}</span>
                <span className="text-xs text-gray-400">{(f.size / 1024).toFixed(0)} KB</span>
                <button onClick={() => removeTxt(f.name)} className="text-gray-400 hover:text-rose-500">
                  <X className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 2. เป้าหมาย: ไฟล์รายชื่อ + กรอกเอง */}
      <div className="card p-5 space-y-4">
        <h3 className="font-semibold text-gray-800 text-sm">2. เลือกรายการที่จะเติม COV-19 (ใช้ร่วมกันได้)</h3>

        <div>
          <label className="label">ก. ไฟล์รายชื่อ Excel/CSV (คอลัมน์ <code>Inv no.</code> หรือ <code>HN</code>)</label>
          {listFile ? (
            <div className="flex items-center gap-2 text-sm bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
              <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
              <span className="flex-1 truncate">{listFile.name}</span>
              <button onClick={() => { setListFile(null); setPreview(null) }} className="text-gray-400 hover:text-rose-500">
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <label className="flex items-center gap-2 text-sm border border-dashed border-gray-300 rounded-lg px-3 py-2 cursor-pointer hover:border-gray-400 w-fit">
              <Upload className="w-4 h-4 text-gray-400" />
              เลือกไฟล์ .xlsx / .xls / .csv
              <input
                type="file" accept=".xlsx,.xls,.csv" className="hidden"
                onChange={(e) => { setListFile(e.target.files?.[0] || null); setPreview(null) }}
              />
            </label>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">ข. กรอก InvNo เอง (คั่นด้วย , เว้นวรรค หรือขึ้นบรรทัดใหม่)</label>
            <textarea
              className="input font-mono text-sm" rows={3}
              placeholder="240025, 240028, 240038"
              value={manualInvnos}
              onChange={(e) => { setManualInvnos(e.target.value); setPreview(null) }}
            />
          </div>
          <div>
            <label className="label">ค. กรอก HN เอง (ทางเลือก)</label>
            <textarea
              className="input font-mono text-sm" rows={3}
              placeholder="000028279&#10;000028280"
              value={manualHns}
              onChange={(e) => { setManualHns(e.target.value); setPreview(null) }}
            />
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => previewMutation.mutate(false)}
          disabled={!canRun || previewMutation.isPending}
          className="btn-secondary"
        >
          <Search className="w-4 h-4" /> {previewMutation.isPending ? 'กำลังตรวจ...' : 'ตรวจสอบก่อนแก้ (Preview)'}
        </button>
        <button
          onClick={() => applyMutation.mutate(false)}
          disabled={!canRun || applyMutation.isPending}
          className="btn-primary"
        >
          <Download className="w-4 h-4" /> {applyMutation.isPending ? 'กำลังแก้...' : 'แก้ไขตามเป้าหมาย & ดาวน์โหลด'}
        </button>

        <div className="h-6 w-px bg-gray-200" />

        <button
          onClick={() => previewMutation.mutate(true)}
          disabled={!hasFile || previewMutation.isPending}
          className="btn-secondary"
          title="ดูว่าจะเติม COV-19 ให้ทุก VN ในไฟล์"
        >
          <Search className="w-4 h-4" /> Preview ทุก VN
        </button>
        <button
          onClick={handleApplyAll}
          disabled={!hasFile || applyMutation.isPending}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50 transition-colors"
          title="เติม COV-19 ให้ทุกรายการในไฟล์ (ไม่ต้องระบุเป้าหมาย)"
        >
          <Biohazard className="w-4 h-4" /> เติมทุก VN & ดาวน์โหลด
        </button>

        {!hasFile && (
          <span className="text-xs text-gray-400 w-full">ต้องอัปโหลดไฟล์ BILLTRAN ก่อน · "เติมทุก VN" ไม่ต้องระบุเป้าหมาย</span>
        )}
      </div>

      {/* Preview result */}
      {preview && (
        <div className="card overflow-hidden">
          <div className="p-4 border-b bg-gray-50 flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2 text-sm">
              <ShieldCheck className={clsx('w-4 h-4', preview.checksum_valid ? 'text-emerald-600' : 'text-gray-400')} />
              <span className="text-gray-600">ไฟล์: <span className="font-mono">{preview.billtran_file}</span></span>
            </div>
            <div className="flex gap-4 text-sm">
              <Stat label="เป้าหมาย" value={preview.target_invno_count + preview.target_hn_count} />
              <Stat label="จับคู่ได้" value={preview.match_count} color="text-blue-600" />
              <Stat label="จะเปลี่ยน" value={preview.will_change_count} color="text-rose-600" />
              <Stat label="เป็น COV-19 อยู่แล้ว" value={preview.already_count} color="text-gray-400" />
            </div>
            <label className="ml-auto flex items-center gap-1.5 text-xs text-gray-600">
              <input type="checkbox" checked={showOnlyMatched} onChange={e => setShowOnlyMatched(e.target.checked)} />
              แสดงเฉพาะที่จับคู่ได้
            </label>
          </div>
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-white sticky top-0 border-b text-xs text-gray-500 uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">InvNo</th>
                  <th className="px-3 py-2 text-left">HN</th>
                  <th className="px-3 py-2 text-left">ชื่อผู้ป่วย</th>
                  <th className="px-3 py-2 text-left">AuthCode เดิม</th>
                  <th className="px-3 py-2 text-left">ผลลัพธ์</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visibleRows.map((r, i) => (
                  <tr key={i} className={clsx(r.will_change && 'bg-rose-50/40')}>
                    <td className="px-3 py-2 font-mono">{r.invno}</td>
                    <td className="px-3 py-2 font-mono text-gray-500">{r.hn}</td>
                    <td className="px-3 py-2">{r.patient_name}</td>
                    <td className="px-3 py-2 font-mono text-gray-400">{r.current_authcode || '(ว่าง)'}</td>
                    <td className="px-3 py-2">
                      {r.will_change ? (
                        <span className="inline-flex items-center gap-1 text-rose-700 font-semibold">
                          <AlertTriangle className="w-3.5 h-3.5" /> → COV-19
                        </span>
                      ) : r.matched ? (
                        <span className="inline-flex items-center gap-1 text-emerald-600">
                          <CheckCircle2 className="w-3.5 h-3.5" /> เป็น COV-19 แล้ว
                        </span>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                  </tr>
                ))}
                {visibleRows.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400">ไม่มีรายการ</td></tr>
                )}
              </tbody>
            </table>
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
