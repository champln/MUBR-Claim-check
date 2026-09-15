import { useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  ArrowLeft, Download, RotateCcw, Save, Table2, ShieldCheck, ShieldAlert, Lock,
} from 'lucide-react'
import clsx from 'clsx'
import {
  getClaimFileRaw, saveClaimFileRawEdits, resetClaimFileRawEdits, downloadClaimFileRaw,
  type RawEdit,
} from '../lib/api'

type Draft = Record<string, string>   // key = "file|section|row|field"
const key = (f: string, s: string, r: number, c: number) => `${f}|${s}|${r}|${c}`

export default function ClaimFileRawEditPage() {
  const { sessionId } = useParams()
  const id = Number(sessionId)
  const qc = useQueryClient()
  const [draft, setDraft] = useState<Draft>({})
  const [openFile, setOpenFile] = useState<string | null>(null)

  const raw = useQuery({ queryKey: ['claim-file-raw', id], queryFn: () => getClaimFileRaw(id) })

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
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'บันทึกไม่สำเร็จ'),
  })

  const resetMutation = useMutation({
    mutationFn: () => resetClaimFileRawEdits(id),
    onSuccess: () => {
      toast.success('ล้างการแก้ไขทั้งหมดแล้ว — กลับไปใช้ไฟล์ต้นฉบับ')
      setDraft({})
      qc.invalidateQueries({ queryKey: ['claim-file-raw', id] })
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
        <Link to={`/claim-files/${id}`} className="text-sm text-blue-600 inline-flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" /> กลับหน้าตรวจไฟล์
        </Link>
        <div className="card p-5 text-sm text-rose-600">{msg}</div>
      </div>
    )
  }

  const data = raw.data!
  const current = openFile || data.files.find(f => f.editable)?.file || data.files[0]?.file
  const file = data.files.find(f => f.file === current)
  const draftCount = Object.keys(draft).length

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to={`/claim-files/${id}`} className="text-sm text-blue-600 inline-flex items-center gap-1 mb-1">
            <ArrowLeft className="w-4 h-4" /> กลับหน้าตรวจไฟล์
          </Link>
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Table2 className="w-5 h-5 text-indigo-600" /> แก้ไขไฟล์ระดับฟิลด์
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            คลิกที่ช่องไหนก็แก้ได้ทุกช่อง — เมื่อดาวน์โหลด ระบบจะเซ็น Checksum (MD5) ใหม่ให้อัตโนมัติ
            {data.source_filename && <> · ไฟล์ต้นฉบับ <code className="text-indigo-700">{data.source_filename}</code></>}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => saveMutation.mutate()} disabled={draftCount === 0 || saveMutation.isPending}
            className="btn-secondary">
            <Save className="w-4 h-4" /> บันทึก{draftCount > 0 ? ` (${draftCount})` : ''}
          </button>
          <button onClick={() => downloadMutation.mutate()}
            disabled={data.pending_edits === 0 || downloadMutation.isPending} className="btn-primary">
            <Download className="w-4 h-4" /> ดาวน์โหลด + เซ็น MD5 ใหม่
          </button>
          {data.pending_edits > 0 && (
            <button onClick={() => { if (confirm('ล้างการแก้ไขทั้งหมด กลับไปใช้ไฟล์ต้นฉบับ?')) resetMutation.mutate() }}
              className="text-gray-400 hover:text-rose-500 p-2" title="ล้างการแก้ไขทั้งหมด">
              <RotateCcw className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {(data.pending_edits > 0 || draftCount > 0) && (
        <div className="text-sm bg-indigo-50 border border-indigo-100 rounded-lg px-4 py-2.5 text-indigo-800">
          แก้ไว้แล้ว <b>{data.pending_edits}</b> ช่อง
          {draftCount > 0 && <> · ยังไม่ได้บันทึกอีก <b>{draftCount}</b> ช่อง (กดบันทึกก่อนดาวน์โหลด)</>}
        </div>
      )}

      {/* แท็บไฟล์ */}
      <div className="flex flex-wrap gap-2">
        {data.files.map(f => (
          <button key={f.file} onClick={() => setOpenFile(f.file)}
            className={clsx('px-3 py-1.5 rounded-lg text-sm border flex items-center gap-1.5',
              f.file === current ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white hover:bg-gray-50')}>
            {f.editable
              ? <ShieldCheck className={clsx('w-3.5 h-3.5', f.file === current ? 'text-white' : 'text-emerald-500')} />
              : <Lock className={clsx('w-3.5 h-3.5', f.file === current ? 'text-white' : 'text-gray-400')} />}
            {f.file}
          </button>
        ))}
      </div>

      {file && !file.editable && (
        <div className="card p-4 text-sm flex items-start gap-2 text-amber-700 bg-amber-50 border-amber-100">
          <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{file.reason || 'ไฟล์นี้แก้ไม่ได้'}</span>
        </div>
      )}

      {file?.sections.map(sec => (
        <div key={sec.section} className="card overflow-hidden">
          <div className="px-4 py-2.5 border-b bg-gray-50 flex items-center justify-between">
            <h3 className="font-semibold text-gray-800 text-sm">
              &lt;{sec.section}&gt; <span className="text-gray-400 font-normal">{sec.rows.length} แถว / {sec.labels.length} ฟิลด์</span>
            </h3>
            {file.checksum_ok && <span className="text-[11px] text-emerald-600">Checksum ต้นฉบับถูกต้อง</span>}
          </div>
          <div className="overflow-x-auto max-h-[28rem] overflow-y-auto">
            <table className="text-sm border-collapse">
              <thead className="bg-white sticky top-0 z-10">
                <tr>
                  <th className="px-2 py-2 text-[11px] text-gray-400 font-normal border-b border-r sticky left-0 bg-white">#</th>
                  {sec.labels.map((label, c) => (
                    <th key={c} className="px-2 py-2 text-left text-[11px] text-gray-500 font-medium border-b whitespace-nowrap">
                      <span className="text-gray-300 mr-1">{c + 1}</span>{label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sec.rows.map((row, r) => (
                  <tr key={r} className="hover:bg-indigo-50/20">
                    <td className="px-2 py-1 text-[11px] text-gray-400 border-r sticky left-0 bg-white">{r + 1}</td>
                    {row.map((cell, c) => {
                      const k = key(file.file, sec.section, r, c)
                      const edited = draft[k] !== undefined
                      return (
                        <td key={c} className="border-b border-gray-50 p-0">
                          <input
                            value={edited ? draft[k] : cell}
                            readOnly={!file.editable}
                            onChange={e => setDraft(d => ({ ...d, [k]: e.target.value }))}
                            className={clsx(
                              'px-2 py-1 text-sm w-full min-w-[6rem] bg-transparent outline-none',
                              'focus:bg-white focus:ring-2 focus:ring-indigo-400 rounded',
                              edited && 'bg-amber-50 font-semibold text-amber-800',
                              !file.editable && 'text-gray-400 cursor-not-allowed',
                            )}
                          />
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {file?.editable && file.sections.length === 0 && (
        <div className="card p-6 text-center text-sm text-gray-400">ไม่พบ section ที่รองรับในไฟล์นี้</div>
      )}
    </div>
  )
}
