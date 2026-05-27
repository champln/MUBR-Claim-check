import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Plus, Pencil, Trash2, Power, AlertCircle, CheckCircle2 } from 'lucide-react'
import clsx from 'clsx'
import { getRules, createRule, updateRule, deleteRule, toggleRule } from '../lib/api'
import { CLAIM_TYPE_LABELS } from '../types/claim'
import type { ValidationRule, ErrorSeverity, ClaimType } from '../types/claim'

const CATEGORIES = ['DOC', 'ICD', 'AMOUNT', 'DATE', 'DRG', 'RIGHTS', 'DRUG', 'C_FLAG', 'CUSTOM']
const CONDITION_TYPES = ['FIELD_REQUIRED', 'AMOUNT_LIMIT']
const CATEGORY_LABELS: Record<string, string> = {
  DOC: 'ความครบถ้วนเอกสาร', ICD: 'รหัส ICD', AMOUNT: 'จำนวนเงิน',
  DATE: 'วันที่/ระยะเวลา', DRG: 'DRG/RW', RIGHTS: 'สิทธิ์การรักษา',
  DRUG: 'ยาและเวชภัณฑ์', C_FLAG: 'C Flag', CUSTOM: 'กำหนดเอง',
}

type RuleForm = {
  rule_code: string
  rule_name: string
  rule_name_th: string
  category: string
  claim_type: string
  condition_type: string
  condition_value: string
  severity: ErrorSeverity
  description: string
}

const EMPTY_FORM: RuleForm = {
  rule_code: '', rule_name: '', rule_name_th: '', category: 'CUSTOM',
  claim_type: '', condition_type: 'FIELD_REQUIRED', condition_value: '',
  severity: 'WARNING', description: '',
}

export default function SettingsPage() {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState<RuleForm>(EMPTY_FORM)
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null)

  const { data: rules = [], isLoading } = useQuery({
    queryKey: ['rules'],
    queryFn: getRules,
  })

  const createMutation = useMutation({
    mutationFn: createRule,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rules'] }); resetForm(); toast.success('เพิ่มกฎเรียบร้อยแล้ว') },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'เกิดข้อผิดพลาด'),
  })
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => updateRule(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rules'] }); resetForm(); toast.success('อัปเดตกฎเรียบร้อยแล้ว') },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'เกิดข้อผิดพลาด'),
  })
  const deleteMutation = useMutation({
    mutationFn: deleteRule,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rules'] }); setConfirmDelete(null); toast.success('ลบกฎเรียบร้อยแล้ว') },
  })
  const toggleMutation = useMutation({
    mutationFn: toggleRule,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rules'] }),
  })

  const resetForm = () => { setForm(EMPTY_FORM); setEditId(null); setShowForm(false) }

  const openEdit = (rule: ValidationRule) => {
    setForm({
      rule_code: rule.rule_code,
      rule_name: rule.rule_name,
      rule_name_th: rule.rule_name_th || '',
      category: rule.category,
      claim_type: rule.claim_type || '',
      condition_type: rule.condition_type,
      condition_value: rule.condition_value || '',
      severity: rule.severity,
      description: rule.description || '',
    })
    setEditId(rule.id)
    setShowForm(true)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const payload = {
      ...form,
      claim_type: (form.claim_type as ClaimType) || undefined,
    }
    if (editId) {
      updateMutation.mutate({ id: editId, data: payload })
    } else {
      createRule(payload as any).then(() => {
        qc.invalidateQueries({ queryKey: ['rules'] })
        resetForm()
        toast.success('เพิ่มกฎเรียบร้อยแล้ว')
      }).catch((e: any) => toast.error(e.response?.data?.detail || 'เกิดข้อผิดพลาด'))
    }
  }

  const set = (k: keyof RuleForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">กฎการตรวจสอบที่กำหนดเอง</h2>
          <p className="text-sm text-gray-500">เพิ่มเงื่อนไขการตรวจสอบเพิ่มเติมนอกเหนือจากกฎมาตรฐาน</p>
        </div>
        <button onClick={() => { resetForm(); setShowForm(true) }} className="btn-primary">
          <Plus className="w-4 h-4" /> เพิ่มกฎใหม่
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="card p-6">
          <h3 className="font-semibold text-gray-900 mb-4">
            {editId ? 'แก้ไขกฎ' : 'เพิ่มกฎใหม่'}
          </h3>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="label">รหัสกฎ * <span className="text-gray-400 text-xs">(unique)</span></label>
              <input value={form.rule_code} onChange={set('rule_code')} required
                className="input font-mono" placeholder="CUSTOM001" />
            </div>
            <div>
              <label className="label">ประเภทกฎ *</label>
              <select value={form.category} onChange={set('category')} className="input">
                {CATEGORIES.map(c => (
                  <option key={c} value={c}>{CATEGORY_LABELS[c] || c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">ชื่อกฎ (ภาษาไทย)</label>
              <input value={form.rule_name_th} onChange={set('rule_name_th')} className="input"
                placeholder="ชื่อกฎสำหรับแสดงผล" />
            </div>
            <div>
              <label className="label">ชื่อกฎ (ภาษาอังกฤษ) *</label>
              <input value={form.rule_name} onChange={set('rule_name')} required className="input"
                placeholder="Rule name" />
            </div>
            <div>
              <label className="label">ใช้กับสิทธิ์</label>
              <select value={form.claim_type} onChange={set('claim_type')} className="input">
                <option value="">ทุกสิทธิ์</option>
                {Object.entries(CLAIM_TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">ระดับความสำคัญ</label>
              <select value={form.severity} onChange={set('severity')} className="input">
                <option value="ERROR">ERROR — ไม่ผ่าน</option>
                <option value="WARNING">WARNING — คำเตือน</option>
                <option value="INFO">INFO — ข้อมูลเพิ่มเติม</option>
              </select>
            </div>
            <div>
              <label className="label">ประเภทเงื่อนไข</label>
              <select value={form.condition_type} onChange={set('condition_type')} className="input">
                <option value="FIELD_REQUIRED">FIELD_REQUIRED — ต้องมีข้อมูลในฟิลด์</option>
                <option value="AMOUNT_LIMIT">AMOUNT_LIMIT — จำกัดจำนวนเงิน</option>
              </select>
            </div>
            <div>
              <label className="label">
                ค่าเงื่อนไข
                {form.condition_type === 'FIELD_REQUIRED' && (
                  <span className="text-gray-400 text-xs ml-1">เช่น: drg_code</span>
                )}
                {form.condition_type === 'AMOUNT_LIMIT' && (
                  <span className="text-gray-400 text-xs ml-1">JSON เช่น: {`{"field":"claim_amount","max":50000}`}</span>
                )}
              </label>
              <input value={form.condition_value} onChange={set('condition_value')}
                className="input font-mono text-xs" />
            </div>
            <div className="md:col-span-2">
              <label className="label">คำอธิบาย</label>
              <textarea value={form.description} onChange={set('description')}
                className="input resize-none" rows={2} />
            </div>
            <div className="md:col-span-2 flex gap-3 justify-end">
              <button type="button" onClick={resetForm} className="btn-secondary">ยกเลิก</button>
              <button type="submit" className="btn-primary">
                {editId ? 'บันทึกการแก้ไข' : 'เพิ่มกฎ'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Rules list */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full" />
          </div>
        ) : rules.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <AlertCircle className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p>ยังไม่มีกฎที่กำหนดเอง ระบบจะใช้กฎมาตรฐานเท่านั้น</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr>
                <th className="table-header">รหัสกฎ</th>
                <th className="table-header">ชื่อกฎ</th>
                <th className="table-header">ประเภท</th>
                <th className="table-header">สิทธิ์</th>
                <th className="table-header">เงื่อนไข</th>
                <th className="table-header">ระดับ</th>
                <th className="table-header text-center">สถานะ</th>
                <th className="table-header text-center">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {rules.map(r => (
                <tr key={r.id} className={clsx('hover:bg-gray-50', !r.is_active && 'opacity-50')}>
                  <td className="table-cell font-mono text-xs text-blue-700">{r.rule_code}</td>
                  <td className="table-cell">
                    <p className="text-sm font-medium">{r.rule_name_th || r.rule_name}</p>
                    {r.rule_name_th && <p className="text-xs text-gray-400">{r.rule_name}</p>}
                  </td>
                  <td className="table-cell text-xs">{CATEGORY_LABELS[r.category] || r.category}</td>
                  <td className="table-cell text-xs">
                    {r.claim_type ? CLAIM_TYPE_LABELS[r.claim_type] : 'ทุกสิทธิ์'}
                  </td>
                  <td className="table-cell text-xs font-mono">{r.condition_type}</td>
                  <td className="table-cell">
                    <span className={clsx('text-xs font-medium px-2 py-0.5 rounded-full', {
                      'bg-red-100 text-red-700': r.severity === 'ERROR',
                      'bg-amber-100 text-amber-700': r.severity === 'WARNING',
                      'bg-blue-100 text-blue-700': r.severity === 'INFO',
                    })}>
                      {r.severity}
                    </span>
                  </td>
                  <td className="table-cell text-center">
                    <button
                      onClick={() => toggleMutation.mutate(r.id)}
                      className={clsx('p-1.5 rounded transition-colors', r.is_active
                        ? 'text-green-600 hover:bg-green-50'
                        : 'text-gray-400 hover:bg-gray-100')}
                      title={r.is_active ? 'ปิดการใช้งาน' : 'เปิดการใช้งาน'}
                    >
                      <Power className="w-4 h-4" />
                    </button>
                  </td>
                  <td className="table-cell">
                    <div className="flex items-center gap-1 justify-center">
                      <button onClick={() => openEdit(r)}
                        className="p-1.5 rounded hover:bg-blue-50 text-blue-600">
                        <Pencil className="w-4 h-4" />
                      </button>
                      {confirmDelete === r.id ? (
                        <div className="flex gap-1">
                          <button onClick={() => deleteMutation.mutate(r.id)}
                            className="px-2 py-1 text-xs bg-red-600 text-white rounded">ลบ</button>
                          <button onClick={() => setConfirmDelete(null)}
                            className="px-2 py-1 text-xs bg-gray-200 rounded">ยก</button>
                        </div>
                      ) : (
                        <button onClick={() => setConfirmDelete(r.id)}
                          className="p-1.5 rounded hover:bg-red-50 text-red-500">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Built-in rules info */}
      <div className="card p-5">
        <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 text-green-600" />
          กฎมาตรฐานที่เปิดใช้งานอยู่เสมอ
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm text-gray-600">
          {[
            ['DOC001-005', 'ตรวจสอบความครบถ้วนของข้อมูลเอกสาร (HN, PID, วันที่, สิทธิ์)'],
            ['ICD001-006', 'ตรวจสอบรูปแบบรหัส ICD-10 / ICD-9 และ PDX ที่ถูกต้อง'],
            ['CFLAG001', 'ตรวจสอบรหัสที่ทำให้ติด C Flag ตามรายการกำหนด'],
            ['DATE001-005', 'ตรวจสอบวันที่รักษา วันจำหน่าย และระยะเวลานอน'],
            ['AMT001-003', 'ตรวจสอบยอดเงินค่ารักษาพยาบาลและยอดเบิก'],
            ['DRG001-002', 'ตรวจสอบรหัส DRG และ RW สำหรับผู้ป่วยใน (IPD)'],
            ['RIGHTS001-002', 'ตรวจสอบข้อมูลสิทธิ์ SSO / CSMBS'],
            ['DOC003', 'ตรวจสอบ Checksum เลขบัตรประชาชน 13 หลัก'],
          ].map(([code, desc]) => (
            <div key={code} className="flex gap-2">
              <code className="text-blue-700 text-xs font-mono shrink-0">{code}</code>
              <span className="text-xs">{desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
