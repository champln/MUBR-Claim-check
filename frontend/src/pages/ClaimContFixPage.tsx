import { useCallback, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { ShieldCheck, Upload, FileText, X, Search, Download } from 'lucide-react'
import clsx from 'clsx'
import { previewClaimContFix, applyClaimContFix, type ClaimContPreviewResult } from '../lib/api'
import FixHistoryPanel from '../components/FixHistoryPanel'

// เหตุผลการใช้ยานอกบัญชียาหลัก (EF = จ่ายเอง ไม่เบิก จึงไม่อยู่ในตัวเลือก)
const CODES: { code: string; label: string }[] = [
  { code: 'EA', label: 'EA — เกิดอาการไม่พึงประสงค์จากยาในบัญชี' },
  { code: 'EB', label: 'EB — ผลการรักษาไม่บรรลุเป้าหมาย' },
  { code: 'EC', label: 'EC — ไม่มียาในบัญชีให้ใช้' },
  { code: 'ED', label: 'ED — มีข้อห้ามใช้ยาในบัญชี' },
  { code: 'EE', label: 'EE — ยาในบัญชีราคาแพงกว่า' },
]

const ISSUE_STYLE: Record<string, string> = {
  G04: 'bg-rose-100 text-rose-700',
  INCOMPLETE: 'bg-amber-100 text-amber-700',
  EF_NO_CLAIM: 'bg-gray-100 text-gray-600',
}

export default function ClaimContFixPage() {
  const [files, setFiles] = useState<File[]>([])
  const [preview, setPreview] = useState<ClaimContPreviewResult | null>(null)
  // แถวที่เลือกแก้ -> รหัสใหม่
  const [picks, setPicks] = useState<Record<number, string>>({})

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

  const previewMutation = useMutation({
    mutationFn: () => previewClaimContFix(files),
    onSuccess: (res) => {
      setPreview(res)
      setPicks(Object.fromEntries(res.rows.filter(r => r.suggested).map(r => [r.row, 'EE'])))
      if (res.rows.length === 0) toast('ไม่มีรายการที่เป็น EF หรือเหตุผลไม่ครบ', { icon: '✅' })
      else if (res.g04_count) toast.success(`พบ EF ที่มียอดเบิก ${res.g04_count} รายการ`)
      else toast('ไม่พบ G04 — มีแต่ EF ที่ไม่มียอดเบิก', { icon: 'ℹ️' })
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'ตรวจสอบไม่สำเร็จ'),
  })

  const applyMutation = useMutation({
    mutationFn: () => applyClaimContFix(files, picks),
    onSuccess: (res) => {
      toast.success(`แก้เหตุผลการใช้ยา ${res.changed} รายการ — ดาวน์โหลด ${res.filename}`)
      if (res.left) toast(`ยังเหลือ EF ที่มียอดเบิกอีก ${res.left} รายการ`, { icon: '⚠️' })
    },
    onError: async (e: any) => {
      let msg = 'แก้ไฟล์ไม่สำเร็จ'
      try { msg = JSON.parse(await e.response.data.text()).detail || msg } catch { /* ignore */ }
      toast.error(msg)
    },
  })

  const toggle = (row: number) => setPicks(p => {
    const next = { ...p }
    if (row in next) delete next[row]
    else next[row] = 'EE'
    return next
  })

  const removeFile = (name: string) => {
    setFiles(prev => prev.filter(f => f.name !== name))
    setPreview(null)
  }

  const pickCount = Object.keys(picks).length

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-violet-600" /> แก้เหตุผลการใช้ยา (C: G04)
        </h2>
        <p className="text-sm text-gray-500 mt-0.5">
          เปลี่ยนเหตุผลการใช้ยา (<code className="text-violet-700">ClaimCont</code>, ฟิลด์ที่ 16) ใน
          <code className="text-violet-700"> BILLDISP → DispensedItems</code> แล้วเซ็น Checksum ใหม่
        </p>
        <div className="mt-3 text-xs text-gray-600 bg-violet-50 border border-violet-100 rounded-lg p-3 space-y-1">
          <div><b>G04</b> — ระบุ claim control เป็น EF (ไม่เบิก) แต่มีการเบิกค่ายา</div>
          <div className="text-gray-500">
            ระบบเลือกแถวที่เป็น EF แต่มียอดเบิกไว้ให้ ค่าเริ่มต้นคือ EE (ค่าที่ใช้บ่อยสุด) —
            <b> ใช้เหตุผลตามที่แพทย์สรุปเสมอ</b> เปลี่ยนรหัสได้ในแต่ละแถว
          </div>
          <div className="text-gray-500">
            แถว EF ที่ไม่มียอดเบิกถือว่าปกติ (ผู้ป่วยจ่ายเอง) — ติ๊กเพิ่มเฉพาะเมื่อแพทย์สรุปให้เปลี่ยนด้วย
          </div>
        </div>
      </div>

      {/* 1. ไฟล์ */}
      <div className="card p-5 space-y-3">
        <h3 className="font-semibold text-gray-800 text-sm">1. ไฟล์ส่งเบิก (BILLDISP .txt หรือ .zip ทั้งชุด)</h3>
        <div {...getRootProps()} className={clsx('border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors',
          isDragActive ? 'border-violet-400 bg-violet-50' : 'border-gray-300 hover:border-gray-400')}>
          <input {...getInputProps()} />
          <Upload className="w-8 h-8 mx-auto text-gray-400 mb-2" />
          <p className="text-sm text-gray-600">ลากวางไฟล์ หรือคลิกเพื่อเลือก (.txt / .zip)</p>
          <p className="text-xs text-gray-400 mt-1">อัปโหลด .zip ทั้งชุดได้ — ระบบแก้เฉพาะ BILLDISP ไฟล์อื่นคงเดิมทุกไบต์</p>
        </div>
        {files.length > 0 && (
          <ul className="space-y-1.5">
            {files.map(f => (
              <li key={f.name} className="flex items-center gap-2 text-sm bg-gray-50 rounded-lg px-3 py-2">
                <FileText className="w-4 h-4 text-violet-500" />
                <span className="flex-1 truncate">{f.name}</span>
                <span className="text-xs text-gray-400">{(f.size / 1024).toFixed(0)} KB</span>
                <button onClick={() => removeFile(f.name)} className="text-gray-400 hover:text-rose-500"><X className="w-4 h-4" /></button>
              </li>
            ))}
          </ul>
        )}
        <button onClick={() => previewMutation.mutate()} disabled={!files.length || previewMutation.isPending} className="btn-secondary">
          <Search className="w-4 h-4" /> {previewMutation.isPending ? 'กำลังตรวจ...' : 'ตรวจเหตุผลการใช้ยา'}
        </button>
      </div>

      {/* 2. เลือกแถว */}
      {preview && (
        <div className="card overflow-hidden">
          <div className="p-4 border-b bg-gray-50 flex flex-wrap items-center gap-5 text-sm">
            <span className="text-gray-600 truncate">{preview.billdisp_file}</span>
            <div className="text-center">
              <div className="font-bold text-rose-600">{preview.g04_count}</div>
              <div className="text-[12px] text-gray-400">EF มียอดเบิก (G04)</div>
            </div>
            <div className="text-center">
              <div className="font-bold text-amber-600">{preview.incomplete_count}</div>
              <div className="text-[12px] text-gray-400">เหตุผลไม่ครบ (E)</div>
            </div>
            <div className="text-center">
              <div className="font-bold text-gray-600">{preview.other_ef_count}</div>
              <div className="text-[12px] text-gray-400">EF ไม่มียอดเบิก</div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-white border-b text-xs text-gray-500">
                <tr>
                  <th className="px-3 py-2 w-10">แก้</th>
                  <th className="px-3 py-2 text-left">ยา</th>
                  <th className="px-3 py-2 text-right">จำนวน</th>
                  <th className="px-3 py-2 text-right">ยอดเบิก</th>
                  <th className="px-3 py-2 text-left">ปัญหา</th>
                  <th className="px-3 py-2 text-left">เดิม</th>
                  <th className="px-3 py-2 text-left">เปลี่ยนเป็น</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {preview.rows.map(r => {
                  const on = r.row in picks
                  return (
                    <tr key={r.row} className={clsx(on && 'bg-violet-50/40')}>
                      <td className="px-3 py-2 text-center">
                        <input type="checkbox" checked={on} onChange={() => toggle(r.row)} />
                      </td>
                      <td className="px-3 py-2">
                        <div className="text-gray-800">{r.drug_name || '(ไม่มีชื่อ)'}</div>
                        <div className="font-mono text-xs text-gray-400">รหัสยา {r.drug_code} · DispID {r.disp_id}</div>
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{r.qty}</td>
                      <td className="px-3 py-2 text-right font-mono">{r.reimb_amt}</td>
                      <td className="px-3 py-2">
                        <span className={clsx('text-[12px] rounded-full px-2 whitespace-nowrap', ISSUE_STYLE[r.issue])}>{r.note}</span>
                      </td>
                      <td className="px-3 py-2 font-mono text-rose-500">{r.claim_cont}</td>
                      <td className="px-3 py-2">
                        <select value={picks[r.row] ?? ''} disabled={!on}
                          onChange={e => setPicks(p => ({ ...p, [r.row]: e.target.value }))}
                          className="border border-gray-300 rounded-lg px-2 py-1 text-sm disabled:opacity-40">
                          {!on && <option value="">—</option>}
                          {CODES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
                        </select>
                      </td>
                    </tr>
                  )
                })}
                {preview.rows.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">ไม่มีรายการที่เป็น EF หรือเหตุผลไม่ครบ</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {preview.rows.length > 0 && (
            <div className="p-4 border-t bg-gray-50 flex flex-wrap items-center gap-4">
              <span className="text-sm text-gray-600">เลือกแก้ {pickCount} รายการ</span>
              <button onClick={() => applyMutation.mutate()} disabled={!pickCount || applyMutation.isPending}
                className="btn-primary ml-auto">
                <Download className="w-4 h-4" /> {applyMutation.isPending ? 'กำลังแก้...' : 'แก้เหตุผล & ดาวน์โหลด'}
              </button>
            </div>
          )}
        </div>
      )}

      <FixHistoryPanel menu="claimcont" />
    </div>
  )
}
