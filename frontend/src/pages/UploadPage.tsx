import { useState, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Upload, FileSpreadsheet, X, AlertCircle, CheckCircle2 } from 'lucide-react'
import clsx from 'clsx'
import { uploadAndPrescreen } from '../lib/api'
import { CLAIM_TYPE_LABELS, MONTHS_TH } from '../types/claim'
import type { ClaimType } from '../types/claim'

const CLAIM_TYPES: ClaimType[] = ['SSO', 'CSMBS', 'UC', 'LGW', 'ECLAIM', 'OPD_SELF', 'OTHER']
const YEARS = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i + 543)
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1)

export default function UploadPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [file, setFile] = useState<File | null>(null)
  const [claimType, setClaimType] = useState<ClaimType>('SSO')
  const [month, setMonth] = useState<number>(new Date().getMonth() + 1)
  const [year, setYear] = useState<number>(new Date().getFullYear() + 543)
  const [uploadedBy, setUploadedBy] = useState('')
  const [note, setNote] = useState('')

  const mutation = useMutation({
    mutationFn: uploadAndPrescreen,
    onSuccess: (batch) => {
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['batches'] })
      toast.success(`ตรวจสอบเสร็จสิ้น! Batch ${batch.batch_no}`)
      navigate(`/batches/${batch.id}`)
    },
    onError: (err: any) => {
      const msg = err.response?.data?.detail || 'เกิดข้อผิดพลาด กรุณาลองใหม่'
      toast.error(msg)
    },
  })

  const onDrop = useCallback((accepted: File[]) => {
    if (accepted[0]) setFile(accepted[0])
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
      'text/csv': ['.csv'],
    },
    maxFiles: 1,
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!file) return toast.error('กรุณาเลือกไฟล์')

    const fd = new FormData()
    fd.append('file', file)
    fd.append('claim_type', claimType)
    fd.append('period_month', String(month))
    fd.append('period_year', String(year - 543)) // store as CE year
    if (uploadedBy) fd.append('uploaded_by', uploadedBy)
    if (note) fd.append('note', note)
    mutation.mutate(fd)
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-1">อัปโหลดไฟล์ข้อมูลส่งเบิก</h2>
        <p className="text-sm text-gray-500 mb-6">รองรับไฟล์ .xlsx, .xls, .csv ขนาดสูงสุด 50 MB</p>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Dropzone */}
          <div>
            <label className="label">ไฟล์ข้อมูล *</label>
            <div
              {...getRootProps()}
              className={clsx(
                'border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all',
                isDragActive
                  ? 'border-blue-500 bg-blue-50'
                  : file
                  ? 'border-green-400 bg-green-50'
                  : 'border-gray-300 hover:border-blue-400 hover:bg-gray-50'
              )}
            >
              <input {...getInputProps()} />
              {file ? (
                <div className="flex items-center justify-center gap-3">
                  <FileSpreadsheet className="w-8 h-8 text-green-600" />
                  <div className="text-left">
                    <p className="font-medium text-green-800">{file.name}</p>
                    <p className="text-sm text-green-600">{formatSize(file.size)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setFile(null) }}
                    className="ml-2 p-1 rounded hover:bg-green-100"
                  >
                    <X className="w-4 h-4 text-green-700" />
                  </button>
                </div>
              ) : (
                <div>
                  <Upload className="w-10 h-10 text-gray-400 mx-auto mb-3" />
                  <p className="text-sm font-medium text-gray-700">
                    {isDragActive ? 'วางไฟล์ที่นี่...' : 'ลากวางไฟล์ หรือคลิกเพื่อเลือก'}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">.xlsx, .xls, .csv</p>
                </div>
              )}
            </div>
          </div>

          {/* Claim Type */}
          <div>
            <label className="label">สิทธิ์การรักษา *</label>
            <select
              value={claimType}
              onChange={(e) => setClaimType(e.target.value as ClaimType)}
              className="input"
            >
              {CLAIM_TYPES.map(ct => (
                <option key={ct} value={ct}>{CLAIM_TYPE_LABELS[ct]}</option>
              ))}
            </select>
          </div>

          {/* Period */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">เดือนที่ส่งเบิก</label>
              <select value={month} onChange={e => setMonth(+e.target.value)} className="input">
                {MONTHS.map(m => (
                  <option key={m} value={m}>{MONTHS_TH[m]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">ปีที่ส่งเบิก (พ.ศ.)</label>
              <select value={year} onChange={e => setYear(+e.target.value)} className="input">
                {YEARS.map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Uploaded by */}
          <div>
            <label className="label">ผู้นำเข้าข้อมูล</label>
            <input
              type="text"
              value={uploadedBy}
              onChange={e => setUploadedBy(e.target.value)}
              className="input"
              placeholder="ชื่อผู้ใช้งาน"
            />
          </div>

          {/* Note */}
          <div>
            <label className="label">หมายเหตุ</label>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              className="input resize-none"
              rows={2}
              placeholder="หมายเหตุเพิ่มเติม (ถ้ามี)"
            />
          </div>

          {/* Info box */}
          <div className="rounded-lg bg-blue-50 border border-blue-200 p-4 flex gap-3">
            <AlertCircle className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
            <div className="text-sm text-blue-800 space-y-1">
              <p className="font-medium">ระบบจะตรวจสอบข้อมูลดังนี้:</p>
              <ul className="list-disc list-inside text-blue-700 space-y-0.5">
                <li>รหัส ICD-10 / ICD-9 วินิจฉัยและหัตถการ</li>
                <li>ความครบถ้วนของข้อมูลเอกสาร</li>
                <li>สิทธิ์การรักษาและข้อมูลผู้ป่วย</li>
                <li>วันที่รักษาและระยะเวลานอน</li>
                <li>จำนวนเงินและรายการค่ารักษา</li>
                <li>การติด C Flag ตามเงื่อนไขที่กำหนด</li>
              </ul>
            </div>
          </div>

          <button
            type="submit"
            disabled={!file || mutation.isPending}
            className="btn-primary w-full justify-center py-3 text-base"
          >
            {mutation.isPending ? (
              <>
                <span className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                กำลังตรวจสอบ...
              </>
            ) : (
              <>
                <Upload className="w-5 h-5" />
                เริ่มนำเข้าและตรวจสอบข้อมูล
              </>
            )}
          </button>
        </form>
      </div>

      {/* Column guide */}
      <div className="card p-5">
        <h3 className="font-semibold text-gray-800 mb-3">คอลัมน์ที่รองรับในไฟล์</h3>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-gray-600">
          {[
            ['HN / patient_id', 'รหัสผู้ป่วย'],
            ['PID / CID', 'เลขบัตรประชาชน'],
            ['ชื่อ-นามสกุล / patient_name', 'ชื่อผู้ป่วย'],
            ['visit_date / วันที่รักษา', 'วันที่รักษา'],
            ['PDX / diag_main', 'วินิจฉัยหลัก ICD-10'],
            ['ADX1-4 / diag_sec1-4', 'วินิจฉัยรอง ICD-10'],
            ['OP1-3 / proc1-3', 'หัตถการ ICD-9'],
            ['DRG / drg_code', 'รหัส DRG'],
            ['RW / relative_weight', 'Relative Weight'],
            ['total_charge / ยอดรวม', 'ยอดค่ารักษารวม'],
            ['claim_amount / ยอดเบิก', 'ยอดที่เบิก'],
            ['สิทธิ์ / claim_type', 'ประเภทสิทธิ์'],
          ].map(([col, desc]) => (
            <div key={col} className="flex gap-2 py-0.5">
              <code className="text-blue-700 font-mono">{col}</code>
              <span className="text-gray-400">→ {desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
