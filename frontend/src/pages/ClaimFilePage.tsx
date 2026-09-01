import { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  Upload, FileText, Trash2, AlertCircle, CheckCircle2,
  AlertTriangle, ChevronRight, FilePlus2
} from 'lucide-react'
import clsx from 'clsx'
import {
  uploadClaimFiles, getClaimFileSessions, deleteClaimFileSession
} from '../lib/api'
import type { ClaimFileSession } from '../types/claimFile'
import { FUND_TYPE_LABELS } from '../types/claimFile'
import { MONTHS_TH } from '../types/claim'

const YEARS = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i + 543)
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1)

export default function ClaimFilePage() {
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [files, setFiles] = useState<File[]>([])
  const [sessionName, setSessionName] = useState('')
  const [month, setMonth] = useState<number>(new Date().getMonth() + 1)
  const [year, setYear] = useState<number>(new Date().getFullYear() + 543)

  const { data: sessions = [], isLoading } = useQuery({
    queryKey: ['claim-file-sessions'],
    queryFn: () => getClaimFileSessions({ limit: 50 }),
  })

  const uploadMutation = useMutation({
    mutationFn: uploadClaimFiles,
    onSuccess: (session) => {
      qc.invalidateQueries({ queryKey: ['claim-file-sessions'] })
      toast.success(`ตรวจสอบเสร็จสิ้น! พบ ${session.error_count} ข้อผิดพลาด`)
      navigate(`/claim-files/${session.id}`)
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || 'เกิดข้อผิดพลาด กรุณาลองใหม่')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: deleteClaimFileSession,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['claim-file-sessions'] })
      toast.success('ลบ session เรียบร้อย')
    },
  })

  const onDrop = useCallback((accepted: File[]) => {
    setFiles(prev => {
      const names = new Set(prev.map(f => f.name))
      return [...prev, ...accepted.filter(f => !names.has(f.name))]
    })
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/plain': ['.txt'],
      'text/xml': ['.xml'],
      'application/xml': ['.xml'],
      'application/zip': ['.zip'],
      'application/x-zip-compressed': ['.zip'],
      'application/octet-stream': ['.cds', '.dbf'],
    },
    maxFiles: 30,
    multiple: true,
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!files.length) return toast.error('กรุณาเลือกไฟล์อย่างน้อย 1 ไฟล์')
    if (!sessionName.trim()) return toast.error('กรุณากรอกชื่อ session')

    const fd = new FormData()
    files.forEach(f => fd.append('files', f))
    fd.append('session_name', sessionName.trim())
    fd.append('period_month', String(month))
    fd.append('period_year', String(year))
    uploadMutation.mutate(fd)
  }

  const removeFile = (name: string) => setFiles(prev => prev.filter(f => f.name !== name))

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">ตรวจสอบไฟล์ส่งเบิก</h1>
        <p className="text-sm text-gray-500 mt-1">
          อัปโหลดไฟล์ CHI export / AIPN / Eclaim เพื่อตรวจหาข้อผิดพลาดและเงื่อนไขติด C
        </p>
      </div>

      {/* Upload form */}
      <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-5">
        <h2 className="font-semibold text-gray-800 flex items-center gap-2">
          <FilePlus2 className="w-5 h-5 text-blue-600" />
          อัปโหลดไฟล์ใหม่
        </h2>

        {/* Session name + period */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="sm:col-span-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">ชื่อ Session</label>
            <input
              type="text"
              value={sessionName}
              onChange={e => setSessionName(e.target.value)}
              placeholder="เช่น SSS OPD เดือน มี.ค. 2568"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">เดือน</label>
            <select
              value={month}
              onChange={e => setMonth(Number(e.target.value))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            >
              {MONTHS.map(m => (
                <option key={m} value={m}>{MONTHS_TH[m - 1]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">ปี (พ.ศ.)</label>
            <select
              value={year}
              onChange={e => setYear(Number(e.target.value))}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
            >
              {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>

        {/* Dropzone */}
        <div
          {...getRootProps()}
          className={clsx(
            'border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors',
            isDragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'
          )}
        >
          <input {...getInputProps()} />
          <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
          <p className="text-sm text-gray-600 font-medium">
            {isDragActive ? 'วางไฟล์ที่นี่...' : 'ลากวางไฟล์ หรือคลิกเพื่อเลือก'}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            รองรับ: BILLTRAN.txt, BILLDISP.txt, OPServices.txt, AIPN*.xml, IDX*.txt, CHT*.txt, ADP*.txt และอื่นๆ หรือไฟล์ .zip
          </p>
        </div>

        {/* File list */}
        {files.length > 0 && (
          <ul className="space-y-1.5">
            {files.map(f => (
              <li key={f.name} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 text-sm">
                <span className="flex items-center gap-2 text-gray-700 truncate">
                  <FileText className="w-4 h-4 text-blue-500 shrink-0" />
                  {f.name}
                  <span className="text-gray-400 text-xs">({(f.size / 1024).toFixed(1)} KB)</span>
                </span>
                <button
                  type="button"
                  onClick={() => removeFile(f.name)}
                  className="text-gray-400 hover:text-red-500 ml-2 shrink-0"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <button
          type="submit"
          disabled={uploadMutation.isPending || !files.length}
          className="w-full sm:w-auto px-6 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {uploadMutation.isPending ? 'กำลังตรวจสอบ...' : 'เริ่มตรวจสอบ'}
        </button>
      </form>

      {/* Session list */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-800">ประวัติการตรวจสอบ</h2>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-gray-400 text-sm">กำลังโหลด...</div>
        ) : sessions.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">ยังไม่มีประวัติการตรวจสอบ</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {sessions.map(s => (
              <SessionRow
                key={s.id}
                session={s}
                onOpen={() => navigate(`/claim-files/${s.id}`)}
                onDelete={() => {
                  if (confirm('ลบ session นี้?')) deleteMutation.mutate(s.id)
                }}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function SessionRow({
  session: s,
  onOpen,
  onDelete,
}: {
  session: ClaimFileSession
  onOpen: () => void
  onDelete: () => void
}) {
  const filesInfo: string[] = s.files_info ? JSON.parse(s.files_info) : []

  return (
    <li className="flex items-center gap-4 px-6 py-4 hover:bg-gray-50 transition-colors">
      <div className="flex-1 min-w-0 cursor-pointer" onClick={onOpen}>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-gray-800 text-sm truncate">{s.session_name}</span>
          <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
            {FUND_TYPE_LABELS[s.fund_type] ?? s.fund_type}
          </span>
          {s.period_month && s.period_year && (
            <span className="text-xs text-gray-400">
              {MONTHS_TH[(s.period_month ?? 1) - 1]} {s.period_year}
            </span>
          )}
        </div>
        <div className="flex items-center gap-4 mt-1.5 text-xs text-gray-500">
          <span>{s.total_records} records</span>
          {s.error_count > 0 && (
            <span className="flex items-center gap-1 text-red-600">
              <AlertCircle className="w-3.5 h-3.5" />
              {s.error_count} ข้อผิดพลาด
            </span>
          )}
          {s.warning_count > 0 && (
            <span className="flex items-center gap-1 text-yellow-600">
              <AlertTriangle className="w-3.5 h-3.5" />
              {s.warning_count} คำเตือน
            </span>
          )}
          {s.error_count === 0 && s.warning_count === 0 && (
            <span className="flex items-center gap-1 text-green-600">
              <CheckCircle2 className="w-3.5 h-3.5" />
              ผ่านทั้งหมด
            </span>
          )}
          <span className="text-gray-400">{filesInfo.length} ไฟล์</span>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={onDelete}
          className="p-1.5 text-gray-400 hover:text-red-500 rounded hover:bg-red-50 transition-colors"
        >
          <Trash2 className="w-4 h-4" />
        </button>
        <button
          onClick={onOpen}
          className="p-1.5 text-gray-400 hover:text-blue-600 rounded hover:bg-blue-50 transition-colors"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </li>
  )
}
