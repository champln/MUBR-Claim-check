import { useCallback, useMemo, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  Pill, Upload, FileText, FileSpreadsheet, X, Search, Download, Plus, Trash2,
} from 'lucide-react'
import clsx from 'clsx'
import {
  previewTmtFix, applyTmtFix,
  type TmtPreviewResult, type TmtRule,
} from '../lib/api'

type RuleForm = { matchBy: 'old_tmt' | 'hosdrugcode'; matchValue: string; newTmt: string }
const EMPTY_RULE: RuleForm = { matchBy: 'old_tmt', matchValue: '', newTmt: '' }

export default function TmtFixPage() {
  const [txtFiles, setTxtFiles] = useState<File[]>([])
  const [listFile, setListFile] = useState<File | null>(null)
  const [rules, setRules] = useState<RuleForm[]>([{ ...EMPTY_RULE }])
  const [preview, setPreview] = useState<TmtPreviewResult | null>(null)

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

  const apiRules: TmtRule[] = useMemo(() =>
    rules
      .filter(r => r.matchValue.trim() && r.newTmt.trim())
      .map(r => ({
        new_tmt: r.newTmt.trim(),
        ...(r.matchBy === 'old_tmt' ? { old_tmt: r.matchValue.trim() } : { hosdrugcode: r.matchValue.trim() }),
      })),
    [rules])

  const hasFile = txtFiles.length > 0
  const hasRules = apiRules.length > 0 || !!listFile
  const canRun = hasFile && hasRules
  const opts = useMemo(() => ({ rules: apiRules, listFile }), [apiRules, listFile])

  const previewMutation = useMutation({
    mutationFn: () => previewTmtFix(txtFiles, opts),
    onSuccess: (res) => {
      setPreview(res)
      if (res.total_change_count === 0) toast('ไม่พบรายการยาที่ตรงกฎในไฟล์', { icon: '⚠️' })
      else toast.success(`จะแก้ TMT: BillItems ${res.billitems_change_count} · DispensedItems ${res.dispitems_change_count}`)
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'ตรวจสอบไม่สำเร็จ'),
  })

  const applyMutation = useMutation({
    mutationFn: () => applyTmtFix(txtFiles, opts),
    onSuccess: (res) => {
      toast.success(`แก้ TMT: BillItems ${res.billitemsChanged} · DispensedItems ${res.dispitemsChanged} · ดาวน์โหลด ${res.filename}`)
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'แก้ไฟล์ไม่สำเร็จ'),
  })

  const removeTxt = (name: string) => { setTxtFiles(prev => prev.filter(f => f.name !== name)); setPreview(null) }
  const setRule = (i: number, patch: Partial<RuleForm>) => {
    setRules(prev => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r)); setPreview(null)
  }
  const addRule = () => setRules(prev => [...prev, { ...EMPTY_RULE }])
  const removeRule = (i: number) => { setRules(prev => prev.filter((_, idx) => idx !== i)); setPreview(null) }

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <Pill className="w-5 h-5 text-violet-600" /> แก้ไขรหัส TMT ยา
        </h2>
        <p className="text-sm text-gray-500 mt-0.5">
          แทนที่รหัส TMT ให้ตรงกันทั้งใน <code className="text-violet-700">BillItems</code> (BILLTRAN) และ <code className="text-violet-700">DispensedItems</code> (BILLDISP) แล้วเซ็น Checksum ใหม่ทั้ง 2 ไฟล์
        </p>
      </div>

      {/* 1. ไฟล์ */}
      <div className="card p-5 space-y-3">
        <h3 className="font-semibold text-gray-800 text-sm">1. ไฟล์ส่งเบิก (แนะนำอัปโหลด .zip ทั้งชุด เพื่อแก้ทั้ง BILLTRAN + BILLDISP)</h3>
        <div {...getRootProps()} className={clsx('border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors',
          isDragActive ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-gray-400')}>
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

      {/* 2. กฎแก้ TMT */}
      <div className="card p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-gray-800 text-sm">2. กฎการแก้ TMT (กรอกเอง หรืออัปโหลดไฟล์)</h3>
          <button onClick={addRule} className="text-xs font-medium text-blue-600 hover:text-blue-700 inline-flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> เพิ่มกฎ</button>
        </div>

        <div className="space-y-2">
          {rules.map((r, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2 bg-gray-50 rounded-lg p-3">
              <div>
                <label className="text-[11px] text-gray-500 block mb-1">จับคู่ด้วย</label>
                <select value={r.matchBy} onChange={e => setRule(i, { matchBy: e.target.value as any })}
                  className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white">
                  <option value="old_tmt">TMT เดิม</option>
                  <option value="hosdrugcode">Hosdrugcode</option>
                </select>
              </div>
              <div>
                <label className="text-[11px] text-gray-500 block mb-1">ค่าที่ค้นหา</label>
                <input value={r.matchValue} onChange={e => setRule(i, { matchValue: e.target.value })}
                  placeholder={r.matchBy === 'old_tmt' ? '849457' : '1592073'}
                  className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm font-mono w-40" />
              </div>
              <div className="text-gray-400 pb-2">→</div>
              <div>
                <label className="text-[11px] text-gray-500 block mb-1">TMT ใหม่</label>
                <input value={r.newTmt} onChange={e => setRule(i, { newTmt: e.target.value })}
                  placeholder="779311"
                  className="border border-violet-300 rounded-lg px-3 py-1.5 text-sm font-mono w-40 focus:ring-1 focus:ring-violet-400 outline-none" />
              </div>
              {rules.length > 1 && (
                <button onClick={() => removeRule(i)} className="text-gray-300 hover:text-rose-500 pb-2"><Trash2 className="w-4 h-4" /></button>
              )}
            </div>
          ))}
        </div>

        <div className="pt-1">
          <label className="text-[11px] text-gray-500 block mb-1">หรือ อัปโหลดไฟล์ Excel/CSV (คอลัมน์: TMT ใหม่ + TMT เดิม/Hosdrugcode)</label>
          {listFile ? (
            <div className="flex items-center gap-2 text-sm bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2 w-fit">
              <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
              <span className="truncate">{listFile.name}</span>
              <button onClick={() => { setListFile(null); setPreview(null) }} className="text-gray-400 hover:text-rose-500"><X className="w-4 h-4" /></button>
            </div>
          ) : (
            <label className="flex items-center gap-2 text-sm border border-dashed border-gray-300 rounded-lg px-3 py-2 cursor-pointer hover:border-gray-400 w-fit">
              <Upload className="w-4 h-4 text-gray-400" /> เลือกไฟล์ .xlsx / .xls / .csv
              <input type="file" accept=".xlsx,.xls,.csv" className="hidden"
                onChange={e => { setListFile(e.target.files?.[0] || null); setPreview(null) }} />
            </label>
          )}
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
        {!canRun && <span className="text-xs text-gray-400">ต้องมีไฟล์ + กฎอย่างน้อย 1 ข้อ (หรือไฟล์ Excel)</span>}
      </div>

      {/* Preview */}
      {preview && (
        <div className="card overflow-hidden">
          <div className="p-4 border-b bg-gray-50 flex flex-wrap items-center gap-4 text-sm">
            <span className="text-gray-600">กฎ {preview.rule_count} ข้อ</span>
            <div className="flex gap-4">
              <Stat label="BillItems" value={preview.billitems_change_count} color="text-blue-600" />
              <Stat label="DispensedItems" value={preview.dispitems_change_count} color="text-violet-600" />
              <Stat label="รวม" value={preview.total_change_count} color="text-gray-800" />
            </div>
            {preview.billdisp_file == null && (
              <span className="text-xs text-amber-600">* ไม่มีไฟล์ BILLDISP — แก้เฉพาะ BillItems</span>
            )}
          </div>
          <div className="overflow-x-auto max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-white sticky top-0 border-b text-xs text-gray-500 uppercase">
                <tr>
                  <th className="px-3 py-2 text-left">ไฟล์</th>
                  <th className="px-3 py-2 text-left">InvNo</th>
                  <th className="px-3 py-2 text-left">Hosdrugcode</th>
                  <th className="px-3 py-2 text-left">ชื่อยา</th>
                  <th className="px-3 py-2 text-left">TMT เดิม</th>
                  <th className="px-3 py-2 text-left">TMT ใหม่</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {preview.rows.map((r, i) => (
                  <tr key={i} className="hover:bg-violet-50/30">
                    <td className="px-3 py-2">
                      <span className={clsx('text-xs px-1.5 py-0.5 rounded', r.file === 'BillItems' ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700')}>{r.file}</span>
                    </td>
                    <td className="px-3 py-2 font-mono">{r.invno}</td>
                    <td className="px-3 py-2 font-mono text-gray-500">{r.hosdrugcode}</td>
                    <td className="px-3 py-2 truncate max-w-xs">{r.desc}</td>
                    <td className="px-3 py-2 font-mono text-gray-400">{r.current_tmt || '(ว่าง)'}</td>
                    <td className="px-3 py-2 font-mono text-violet-700 font-semibold">→ {r.new_tmt}</td>
                  </tr>
                ))}
                {preview.rows.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">ไม่มีรายการที่ตรงกฎ</td></tr>
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
