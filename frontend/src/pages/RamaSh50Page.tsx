import { useCallback, useMemo, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  HeartPulse, Upload, FileText, X, Search, Download,
  CheckCircle2, ShieldCheck, Building2, Coins,
} from 'lucide-react'
import clsx from 'clsx'
import {
  previewRamaSh50, applyRamaSh50,
  type RamaSh50PreviewResult,
} from '../lib/api'

export default function RamaSh50Page() {
  const [txtFiles, setTxtFiles] = useState<File[]>([])
  const [hmain, setHmain] = useState('13781')
  const [shAmount, setShAmount] = useState('50.00')
  const [excludeInvnos, setExcludeInvnos] = useState('')
  const [preview, setPreview] = useState<RamaSh50PreviewResult | null>(null)
  const [showOnlyChanged, setShowOnlyChanged] = useState(true)

  const onDrop = useCallback((accepted: File[]) => {
    setTxtFiles(prev => {
      const names = new Set(prev.map(f => f.name))
      return [...prev, ...accepted.filter(f => !names.has(f.name))]
    })
    setPreview(null)
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'text/plain': ['.txt'], 'application/zip': ['.zip'], 'application/x-zip-compressed': ['.zip'] },
  })

  const opts = useMemo(() => ({
    hmain: hmain.trim() || undefined,
    shAmount: shAmount.trim() || undefined,
    excludeInvnos: excludeInvnos.trim() || undefined,
  }), [hmain, shAmount, excludeInvnos])
  const hasFile = txtFiles.length > 0

  const previewMutation = useMutation({
    mutationFn: () => previewRamaSh50(txtFiles, opts),
    onSuccess: (res) => {
      setPreview(res)
      toast.success(`เติม HMain ${res.hmain_fill_count} แถว · ตั้ง SH ${res.sh_set_count} แถว`)
    },
    onError: (e: any) => toast.error(e.friendlyMessage || e.response?.data?.detail || 'ตรวจสอบไม่สำเร็จ'),
  })

  const applyMutation = useMutation({
    mutationFn: () => applyRamaSh50(txtFiles, opts),
    onSuccess: (res) => {
      toast.success(`เติม HMain ${res.hmainFilled} · SH ${res.shSet} · ดาวน์โหลด ${res.filename} แล้ว`)
    },
    onError: (e: any) => toast.error(e.friendlyMessage || e.response?.data?.detail || 'แก้ไฟล์ไม่สำเร็จ'),
  })

  const removeTxt = (name: string) => {
    setTxtFiles(prev => prev.filter(f => f.name !== name))
    setPreview(null)
  }

  const visibleRows = useMemo(() => {
    if (!preview) return []
    return showOnlyChanged
      ? preview.rows.filter(r => r.will_fill_hmain || r.will_set_sh || r.excluded)
      : preview.rows
  }, [preview, showOnlyChanged])

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <HeartPulse className="w-5 h-5 text-pink-600" /> เติมข้อมูลประกันสังคมรามา (SH 50)
        </h2>
        <p className="text-sm text-gray-500 mt-0.5">
          เติม <code className="text-pink-700">HMain=13781</code> (รพ.หลักรามาธิบดี) และ <code className="text-pink-700">OtherPayplan=SH / 50.00</code> ใน BILLTRAN แล้วเซ็น Checksum ใหม่
        </p>
      </div>

      {/* คำอธิบายเงื่อนไข */}
      <div className="card p-4 bg-blue-50/40 border-blue-100 text-sm text-gray-600 space-y-1">
        <div className="flex items-start gap-2"><Building2 className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" /> <span><b>เงื่อนไข 1:</b> แถวที่ <code>HMain</code> (ช่อง 15) ว่าง → เติมรหัส รพ.หลัก</span></div>
        <div className="flex items-start gap-2"><Coins className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" /> <span><b>เงื่อนไข 2:</b> visit ที่มี <b>ค่าธรรมเนียมโรงพยาบาล 50 บาท</b> (รายการ BillMu=G ใน BillItems) และยังไม่มีผู้ร่วมจ่าย → ตั้ง <code>OtherPayplan=SH</code>, <code>OtherPay=50.00</code></span></div>
        <div className="text-xs text-gray-400 pl-6">* ดูจากรายการค่าธรรมเนียมใน BillItems ไม่ใช่ส่วนต่างยอดเงิน — visit ที่ไม่มีค่าธรรมเนียม (เช่น visit ต่อเนื่องวันเดียวกัน) จะไม่ถูกตั้ง SH</div>
      </div>

      {/* 1. ไฟล์ */}
      <div className="card p-5 space-y-3">
        <h3 className="font-semibold text-gray-800 text-sm">1. ไฟล์ส่งเบิก BILLTRAN (.txt หรือ .zip)</h3>
        <div
          {...getRootProps()}
          className={clsx('border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors',
            isDragActive ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-gray-400')}
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
                <button onClick={() => removeTxt(f.name)} className="text-gray-400 hover:text-rose-500"><X className="w-4 h-4" /></button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 2. พารามิเตอร์ */}
      <div className="card p-5 space-y-4">
        <h3 className="font-semibold text-gray-800 text-sm">2. ค่าที่ใช้เติม (ปรับได้)</h3>
        <div className="flex flex-wrap gap-4">
          <div>
            <label className="label">รหัส รพ.หลัก (HMain)</label>
            <input className="input font-mono w-40" value={hmain} onChange={e => { setHmain(e.target.value); setPreview(null) }} placeholder="13781" />
          </div>
          <div>
            <label className="label">ค่าธรรมเนียม/ยอด SH</label>
            <input className="input font-mono w-32" value={shAmount} onChange={e => { setShAmount(e.target.value); setPreview(null) }} placeholder="50.00" />
          </div>
        </div>
        <div>
          <label className="label">ยกเว้น Inv.no (ไม่ตั้ง SH) — คั่นด้วย , เว้นวรรค หรือขึ้นบรรทัดใหม่</label>
          <textarea
            className="input font-mono text-sm" rows={2}
            placeholder="เช่น 268747, 268760  (visit ที่ 2+ ในวันเดียวกัน ไม่เก็บค่าธรรมเนียมซ้ำ)"
            value={excludeInvnos}
            onChange={e => { setExcludeInvnos(e.target.value); setPreview(null) }}
          />
          <p className="text-xs text-gray-400 mt-1">HMain ยังเติมปกติ — ยกเว้นเฉพาะการตั้ง SH/50.00 สำหรับ Inv.no เหล่านี้</p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => previewMutation.mutate()} disabled={!hasFile || previewMutation.isPending} className="btn-secondary">
          <Search className="w-4 h-4" /> {previewMutation.isPending ? 'กำลังตรวจ...' : 'ตรวจสอบก่อนแก้ (Preview)'}
        </button>
        <button onClick={() => applyMutation.mutate()} disabled={!hasFile || applyMutation.isPending} className="btn-primary">
          <Download className="w-4 h-4" /> {applyMutation.isPending ? 'กำลังแก้...' : 'แก้ไข & ดาวน์โหลด'}
        </button>
        {!hasFile && <span className="text-xs text-gray-400">ต้องอัปโหลดไฟล์ BILLTRAN ก่อน</span>}
      </div>

      {/* Preview */}
      {preview && (
        <div className="card overflow-hidden">
          <div className="p-4 border-b bg-gray-50 flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2 text-sm">
              <ShieldCheck className={clsx('w-4 h-4', preview.checksum_valid ? 'text-emerald-600' : 'text-gray-400')} />
              <span className="text-gray-600">ไฟล์: <span className="font-mono">{preview.billtran_file}</span></span>
            </div>
            <div className="flex gap-4 text-sm">
              <Stat label="ทั้งหมด" value={preview.total_rows} />
              <Stat label={`เติม HMain=${preview.hmain_code}`} value={preview.hmain_fill_count} color="text-blue-600" />
              <Stat label={`ตั้ง SH ${preview.sh_amount}`} value={preview.sh_set_count} color="text-pink-600" />
              {preview.excluded_count > 0 && <Stat label="ยกเว้น SH" value={preview.excluded_count} color="text-amber-600" />}
            </div>
            <label className="ml-auto flex items-center gap-1.5 text-xs text-gray-600">
              <input type="checkbox" checked={showOnlyChanged} onChange={e => setShowOnlyChanged(e.target.checked)} />
              แสดงเฉพาะที่จะเปลี่ยน
            </label>
          </div>
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-white sticky top-0 border-b text-xs text-gray-500 uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">InvNo</th>
                  <th className="px-3 py-2 text-left">ชื่อผู้ป่วย</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2 text-right">ClaimAmt</th>
                  <th className="px-3 py-2 text-right">ส่วนต่าง</th>
                  <th className="px-3 py-2 text-left">HMain</th>
                  <th className="px-3 py-2 text-left">SH</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visibleRows.map((r, i) => (
                  <tr key={i} className={clsx(r.excluded && r.diff === 50 ? 'bg-amber-50/40' : (r.will_fill_hmain || r.will_set_sh) && 'bg-blue-50/30')}>
                    <td className="px-3 py-2 font-mono">{r.invno}</td>
                    <td className="px-3 py-2">{r.patient_name}</td>
                    <td className="px-3 py-2 text-right font-mono">{r.amount.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right font-mono">{r.claim_amt.toFixed(2)}</td>
                    <td className={clsx('px-3 py-2 text-right font-mono', r.diff === 50 ? 'text-pink-600 font-semibold' : 'text-gray-400')}>{r.diff.toFixed(2)}</td>
                    <td className="px-3 py-2">
                      {r.will_fill_hmain
                        ? <span className="text-blue-700 font-semibold">→ {preview.hmain_code}</span>
                        : <span className="text-gray-400 font-mono">{r.current_hmain || '—'}</span>}
                    </td>
                    <td className="px-3 py-2">
                      {r.will_set_sh
                        ? <span className="inline-flex items-center gap-1 text-pink-700 font-semibold"><Coins className="w-3.5 h-3.5" /> → SH {preview.sh_amount}</span>
                        : r.excluded && r.diff === 50
                          ? <span className="text-amber-600 font-medium">ยกเว้น (ไม่ตั้ง SH)</span>
                          : <span className="text-gray-300">—</span>}
                    </td>
                  </tr>
                ))}
                {visibleRows.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">ไม่มีรายการที่ต้องเปลี่ยน</td></tr>
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
