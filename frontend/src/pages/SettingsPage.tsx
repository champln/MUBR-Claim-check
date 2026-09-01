import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Plus, Pencil, Trash2, Power, AlertCircle, CheckCircle2 } from 'lucide-react'
import clsx from 'clsx'
import {
  getRules, createRule, updateRule, deleteRule, toggleRule,
  getUsers, createUser, updateUser, getAuditLogs,
  getHosxpSelections, createHosxpSelection, updateHosxpSelection, syncHosxpSelections,
  getHosxpConfig, upsertHosxpConfig, getHosxpCandidates, bulkUpsertHosxpSelections, detectHosxpAuth,
  getLivePrescreenStatus,
} from '../lib/api'
import { getAuthUser } from '../lib/session'
import { CLAIM_TYPE_LABELS } from '../types/claim'
import type { ValidationRule, ErrorSeverity, ClaimType } from '../types/claim'
import type {
  AuthUser, HosxpConnectionConfigUpsertRequest, HosxpUserCandidate,
  HosxpUserSelection, UserAuditLog, UserRole,
} from '../types/auth'

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

type UserForm = {
  username: string
  full_name: string
  password: string
  role: UserRole
}

const EMPTY_USER_FORM: UserForm = {
  username: '',
  full_name: '',
  password: '',
  role: 'OPERATOR',
}

type HosxpSelectionForm = {
  hosxp_username: string
  full_name: string
  role: UserRole
  is_active: boolean
}

const EMPTY_HOSXP_FORM: HosxpSelectionForm = {
  hosxp_username: '',
  full_name: '',
  role: 'OPERATOR',
  is_active: true,
}

export default function SettingsPage({ view = 'rules' }: { view?: 'rules' | 'system' }) {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState<RuleForm>(EMPTY_FORM)
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null)
  const [userForm, setUserForm] = useState<UserForm>(EMPTY_USER_FORM)
  const [hosxpForm, setHosxpForm] = useState<HosxpSelectionForm>(EMPTY_HOSXP_FORM)
  const [hosxpConfigForm, setHosxpConfigForm] = useState<HosxpConnectionConfigUpsertRequest>({
    db_url: '',
    user_table: '',
    username_column: '',
    full_name_column: '',
    active_column: '',
    is_enabled: true,
  })
  const [hosxpSearch, setHosxpSearch] = useState('')
  const [selectedCandidates, setSelectedCandidates] = useState<Record<string, boolean>>({})
  const [detectForm, setDetectForm] = useState({ username: '', password: '' })

  const currentUser = getAuthUser()
  const isAdmin = currentUser?.role === 'ADMIN'
  const canManageRules = currentUser?.role === 'ADMIN' || currentUser?.role === 'REVIEWER'

  if (!canManageRules) {
    return (
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-gray-900">ไม่มีสิทธิ์เข้าถึงหน้านี้</h2>
        <p className="text-sm text-gray-500 mt-1">กรุณาติดต่อผู้ดูแลระบบ หากต้องการจัดการกฎการตรวจสอบ</p>
      </div>
    )
  }

  const { data: rules = [], isLoading } = useQuery({
    queryKey: ['rules'],
    queryFn: getRules,
  })

  const { data: users = [], isLoading: isUsersLoading } = useQuery({
    queryKey: ['users'],
    queryFn: getUsers,
    enabled: isAdmin,
  })

  const { data: auditLogs = [], isLoading: isAuditLoading } = useQuery({
    queryKey: ['audit-logs'],
    queryFn: () => getAuditLogs(100),
    enabled: isAdmin,
  })

  const { data: hosxpSelections = [], isLoading: isHosxpLoading } = useQuery({
    queryKey: ['hosxp-selections'],
    queryFn: getHosxpSelections,
    enabled: isAdmin,
  })

  const { data: hosxpConfig } = useQuery({
    queryKey: ['hosxp-config'],
    queryFn: getHosxpConfig,
    enabled: isAdmin,
  })

  const { data: hosxpCandidates = [], isLoading: isHosxpCandidateLoading } = useQuery({
    queryKey: ['hosxp-candidates', hosxpSearch],
    queryFn: () => getHosxpCandidates({ search: hosxpSearch || undefined, limit: 100 }),
    enabled: isAdmin && !!hosxpConfig?.is_enabled,
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

  const createUserMutation = useMutation({
    mutationFn: createUser,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      setUserForm(EMPTY_USER_FORM)
      toast.success('เพิ่มผู้ใช้เรียบร้อยแล้ว')
    },
    onError: (e: any) => toast.error(e.friendlyMessage || e.response?.data?.detail || 'เกิดข้อผิดพลาด'),
  })

  const updateUserMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => updateUser(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      toast.success('บันทึกข้อมูลผู้ใช้เรียบร้อยแล้ว')
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'เกิดข้อผิดพลาด'),
  })

  const createHosxpSelectionMutation = useMutation({
    mutationFn: createHosxpSelection,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hosxp-selections'] })
      setHosxpForm(EMPTY_HOSXP_FORM)
      toast.success('เพิ่มรายการผู้ใช้ HOSxP เรียบร้อยแล้ว')
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'เกิดข้อผิดพลาด'),
  })

  const updateHosxpSelectionMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => updateHosxpSelection(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hosxp-selections'] })
      toast.success('อัปเดตรายการ HOSxP เรียบร้อยแล้ว')
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'เกิดข้อผิดพลาด'),
  })

  const syncHosxpMutation = useMutation({
    mutationFn: syncHosxpSelections,
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['hosxp-selections'] })
      qc.invalidateQueries({ queryKey: ['users'] })
      qc.invalidateQueries({ queryKey: ['audit-logs'] })
      toast.success(`Sync สำเร็จ: ใหม่ ${res.created_users}, อัปเดต ${res.updated_users}, ปิดใช้งาน ${res.deactivated_users}`)
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'เกิดข้อผิดพลาด'),
  })

  const upsertHosxpConfigMutation = useMutation({
    mutationFn: upsertHosxpConfig,
    onSuccess: (res) => {
      setHosxpConfigForm({
        db_url: res.db_url || '',
        user_table: res.user_table || '',
        username_column: res.username_column || '',
        full_name_column: res.full_name_column || '',
        active_column: res.active_column || '',
        is_enabled: res.is_enabled,
      })
      qc.invalidateQueries({ queryKey: ['hosxp-config'] })
      qc.invalidateQueries({ queryKey: ['hosxp-candidates'] })
      toast.success('บันทึกการตั้งค่า HOSxP เรียบร้อยแล้ว')
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'บันทึกการตั้งค่าไม่สำเร็จ'),
  })

  const testConnMutation = useMutation({
    mutationFn: getLivePrescreenStatus,
    onSuccess: (res) => {
      if (res.reachable) toast.success('เชื่อมต่อฐาน HOSxP สำเร็จ · พร้อมใช้ Pre-screen สด')
      else toast.error(res.message || 'เชื่อมต่อฐาน HOSxP ไม่สำเร็จ')
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'ทดสอบการเชื่อมต่อไม่สำเร็จ'),
  })

  const detectAuthMutation = useMutation({
    mutationFn: detectHosxpAuth,
    onSuccess: (res) => {
      setDetectForm({ username: '', password: '' })
      qc.invalidateQueries({ queryKey: ['hosxp-config'] })
      toast.success(`ตรวจพบวิธียืนยันรหัส: คอลัมน์ ${res.password_column} · ${res.auth_method} — เปิดใช้ login สด HOSxP แล้ว`)
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'ตรวจจับวิธียืนยันรหัสไม่สำเร็จ'),
  })

  const bulkUpsertHosxpSelectionMutation = useMutation({
    mutationFn: bulkUpsertHosxpSelections,
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['hosxp-selections'] })
      qc.invalidateQueries({ queryKey: ['hosxp-candidates'] })
      setSelectedCandidates({})
      toast.success(`เพิ่ม/อัปเดตรายการที่เลือกแล้ว (ใหม่ ${res.created}, อัปเดต ${res.updated})`)
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'เพิ่มรายการไม่สำเร็จ'),
  })

  const setHosxpConfig = (k: keyof HosxpConnectionConfigUpsertRequest) => (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const value = k === 'is_enabled' ? e.target.checked : e.target.value
    setHosxpConfigForm((f) => ({ ...f, [k]: value as any }))
  }

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

  const setUser = (k: keyof UserForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setUserForm(f => ({ ...f, [k]: e.target.value }))

  const setHosxp = (k: keyof HosxpSelectionForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setHosxpForm((f) => ({
      ...f,
      [k]: k === 'is_active' ? (e.target as HTMLInputElement).checked : e.target.value,
    }))

  const handleCreateUser = (e: React.FormEvent) => {
    e.preventDefault()
    createUserMutation.mutate({
      username: userForm.username.trim(),
      full_name: userForm.full_name || undefined,
      password: userForm.password,
      role: userForm.role,
    })
  }

  const setUserRole = (user: AuthUser, role: UserRole) => {
    updateUserMutation.mutate({ id: user.id, data: { role } })
  }

  const toggleUserActive = (user: AuthUser) => {
    updateUserMutation.mutate({ id: user.id, data: { is_active: !user.is_active } })
  }

  const handleCreateHosxpSelection = (e: React.FormEvent) => {
    e.preventDefault()
    createHosxpSelectionMutation.mutate({
      hosxp_username: hosxpForm.hosxp_username.trim(),
      full_name: hosxpForm.full_name || undefined,
      role: hosxpForm.role,
      is_active: hosxpForm.is_active,
    })
  }

  const toggleHosxpSelectionActive = (item: HosxpUserSelection) => {
    updateHosxpSelectionMutation.mutate({ id: item.id, data: { is_active: !item.is_active } })
  }

  const setHosxpRole = (item: HosxpUserSelection, role: UserRole) => {
    updateHosxpSelectionMutation.mutate({ id: item.id, data: { role } })
  }

  const toggleCandidate = (username: string) => {
    setSelectedCandidates((prev) => ({ ...prev, [username]: !prev[username] }))
  }

  const handleSaveHosxpConfig = (e: React.FormEvent) => {
    e.preventDefault()
    upsertHosxpConfigMutation.mutate({
      ...hosxpConfigForm,
      db_url: hosxpConfigForm.db_url.trim(),
      user_table: hosxpConfigForm.user_table?.trim() || undefined,
      username_column: hosxpConfigForm.username_column?.trim() || undefined,
      full_name_column: hosxpConfigForm.full_name_column?.trim() || undefined,
      active_column: hosxpConfigForm.active_column?.trim() || undefined,
    })
  }

  const handleBulkApproveCandidates = () => {
    const selectedItems = hosxpCandidates
      .filter((x) => selectedCandidates[x.hosxp_username])
      .map((x) => ({
        hosxp_username: x.hosxp_username,
        full_name: x.full_name,
        role: 'OPERATOR' as UserRole,
        is_active: x.is_active,
      }))

    if (selectedItems.length === 0) {
      toast.error('กรุณาเลือกผู้ใช้ HOSxP อย่างน้อย 1 รายการ')
      return
    }

    bulkUpsertHosxpSelectionMutation.mutate({ items: selectedItems })
  }

  useEffect(() => {
    if (!hosxpConfig) return
    setHosxpConfigForm((prev) => {
      if (prev.db_url) return prev
      return {
        db_url: hosxpConfig.db_url || '',
        user_table: hosxpConfig.user_table || '',
        username_column: hosxpConfig.username_column || '',
        full_name_column: hosxpConfig.full_name_column || '',
        active_column: hosxpConfig.active_column || '',
        is_enabled: hosxpConfig.is_enabled,
      }
    })
  }, [hosxpConfig])

  return (
    <div className="space-y-6">
      {view === 'rules' && (<>
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
      </>)}

      {view === 'system' && (<>
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900">ตั้งค่าระบบ</h2>
        <p className="text-sm text-gray-500">การเชื่อมต่อฐาน HOSxP และการจัดการผู้ใช้งาน</p>
      </div>

      {!isAdmin && (
        <div className="card p-6 text-sm text-gray-500">
          เฉพาะผู้ดูแลระบบ (ADMIN) เท่านั้นที่เข้าถึงการตั้งค่าระบบได้
        </div>
      )}

      {isAdmin && (
        <div className="card p-5 space-y-4">
          <div>
            <h3 className="font-semibold text-gray-900">การเชื่อมต่อฐาน HOSxP</h3>
            <p className="text-sm text-gray-500">
              connection เดียวนี้ใช้ทั้ง 3 อย่าง: ค้นหา/เลือกผู้ใช้ HOSxP · ล็อกอินด้วยรหัส HOSxP จริง (live-auth) · <span className="font-medium text-blue-700">Pre-screen สด (ดึง visit มาตรวจทันที)</span>
            </p>
          </div>

          <form className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end" onSubmit={handleSaveHosxpConfig}>
            <div className="md:col-span-3">
              <label className="label">DB URL *</label>
              <input
                className="input"
                placeholder="postgresql+psycopg2://user:password@host:5432/hos  (HOSxP XE)  |  mysql+pymysql://user:password@host:3306/hos  (HOSxP เก่า)"
                value={hosxpConfigForm.db_url}
                onChange={setHosxpConfig('db_url')}
                required
              />
              <p className="text-xs text-gray-400 mt-1">
                HOSxP XE = PostgreSQL (`postgresql+psycopg2://`) · HOSxP รุ่นเก่า = MySQL (`mysql+pymysql://`) — แนะนำใช้ user แบบอ่านอย่างเดียว (read-only)
              </p>
            </div>
            <div>
              <label className="label">User Table (optional)</label>
              <input className="input" value={hosxpConfigForm.user_table || ''} onChange={setHosxpConfig('user_table')} placeholder="opduser" />
            </div>
            <div>
              <label className="label">Username Column (optional)</label>
              <input className="input" value={hosxpConfigForm.username_column || ''} onChange={setHosxpConfig('username_column')} placeholder="loginname" />
            </div>
            <div>
              <label className="label">Full Name Column (optional)</label>
              <input className="input" value={hosxpConfigForm.full_name_column || ''} onChange={setHosxpConfig('full_name_column')} placeholder="name" />
            </div>
            <div>
              <label className="label">Active Column (optional)</label>
              <input className="input" value={hosxpConfigForm.active_column || ''} onChange={setHosxpConfig('active_column')} placeholder="active" />
            </div>
            <label className="inline-flex items-center gap-2 text-sm text-gray-700 h-10">
              <input type="checkbox" checked={hosxpConfigForm.is_enabled} onChange={setHosxpConfig('is_enabled')} />
              เปิดใช้งาน
            </label>
            <div className="md:col-span-3 flex justify-end gap-2">
              <button
                type="button"
                className="btn-secondary"
                disabled={testConnMutation.isPending || !hosxpConfig?.is_enabled}
                title={!hosxpConfig?.is_enabled ? 'บันทึกและเปิดใช้งานก่อนจึงจะทดสอบได้' : 'ทดสอบว่าเชื่อมต่อฐาน HOSxP ที่บันทึกไว้ได้จริง'}
                onClick={() => testConnMutation.mutate()}
              >
                {testConnMutation.isPending ? 'กำลังทดสอบ...' : 'ทดสอบการเชื่อมต่อ'}
              </button>
              <button type="submit" className="btn-primary" disabled={upsertHosxpConfigMutation.isPending}>
                {upsertHosxpConfigMutation.isPending ? 'กำลังบันทึก...' : 'บันทึกการตั้งค่า'}
              </button>
            </div>
          </form>

          {/* Live-auth: ตรวจจับวิธียืนยันรหัส HOSxP */}
          <div className="pt-4 border-t border-gray-200">
            <div className="flex items-center gap-2 mb-1">
              <p className="text-sm font-medium text-gray-800">เปิดใช้ล็อกอินด้วยรหัส HOSxP จริง (live-auth)</p>
              {hosxpConfig?.auth_method ? (
                <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                  พร้อม · {hosxpConfig.password_column} / {hosxpConfig.auth_method}
                </span>
              ) : (
                <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">ยังไม่ตั้งค่า</span>
              )}
            </div>
            <p className="text-xs text-gray-500 mb-3">
              กรอกชื่อผู้ใช้ + รหัสผ่าน HOSxP ของจริง 1 บัญชี (แนะนำใช้ของตัวเอง) ระบบจะหาว่าฐาน HOSxP ใช้วิธีเข้ารหัสแบบไหน แล้วจำไว้ให้ทุกคนล็อกอินด้วยรหัส HOSxP ได้เลย · ระบบไม่เก็บรหัสที่กรอก
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <input
                className="input"
                placeholder="HOSxP username (เช่นของคุณเอง)"
                value={detectForm.username}
                onChange={(e) => setDetectForm((f) => ({ ...f, username: e.target.value }))}
              />
              <input
                className="input"
                type="password"
                placeholder="รหัสผ่าน HOSxP"
                value={detectForm.password}
                onChange={(e) => setDetectForm((f) => ({ ...f, password: e.target.value }))}
              />
              <button
                type="button"
                className="btn-secondary"
                disabled={detectAuthMutation.isPending || !detectForm.username.trim() || !detectForm.password}
                onClick={() => detectAuthMutation.mutate({ username: detectForm.username.trim(), password: detectForm.password })}
              >
                {detectAuthMutation.isPending ? 'กำลังตรวจจับ...' : 'ตรวจจับ & เปิดใช้'}
              </button>
            </div>
          </div>

          <div className="pt-2 border-t border-gray-200">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <p className="text-sm font-medium text-gray-800">ค้นหาผู้ใช้จาก HOSxP เพื่อเพิ่มเข้า allowlist</p>
                <p className="text-xs text-gray-500">เลือกได้หลายรายการ แล้วกดเพิ่มครั้งเดียว</p>
              </div>
              <button
                type="button"
                className="btn-secondary"
                disabled={bulkUpsertHosxpSelectionMutation.isPending}
                onClick={handleBulkApproveCandidates}
              >
                เพิ่มรายการที่เลือก
              </button>
            </div>
            <input
              className="input mb-3"
              placeholder="ค้นหาจาก username หรือชื่อ"
              value={hosxpSearch}
              onChange={(e) => setHosxpSearch(e.target.value)}
            />

            {isHosxpCandidateLoading ? (
              <div className="text-sm text-gray-500">กำลังค้นหาผู้ใช้ HOSxP...</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className="table-header text-center">เลือก</th>
                      <th className="table-header">Username</th>
                      <th className="table-header">ชื่อ</th>
                      <th className="table-header">สถานะใน HOSxP</th>
                      <th className="table-header">สถานะใน Allowlist</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hosxpCandidates.map((item: HosxpUserCandidate) => (
                      <tr key={item.hosxp_username}>
                        <td className="table-cell text-center">
                          <input
                            type="checkbox"
                            checked={!!selectedCandidates[item.hosxp_username]}
                            onChange={() => toggleCandidate(item.hosxp_username)}
                          />
                        </td>
                        <td className="table-cell font-mono text-xs">{item.hosxp_username}</td>
                        <td className="table-cell text-sm">{item.full_name || '-'}</td>
                        <td className="table-cell text-xs">{item.is_active ? 'Active' : 'Inactive'}</td>
                        <td className="table-cell text-xs">
                          {item.already_selected
                            ? (item.selected_active ? 'เลือกแล้ว (active)' : 'เลือกแล้ว (inactive)')
                            : 'ยังไม่เลือก'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {isAdmin && (
        <div className="card p-5 space-y-5">
          <div>
            <h3 className="font-semibold text-gray-900">จัดการผู้ใช้งาน</h3>
            <p className="text-sm text-gray-500">สำหรับผู้ดูแลระบบในการสร้างผู้ใช้และกำหนดสิทธิ์การใช้งาน</p>
          </div>

          <form onSubmit={handleCreateUser} className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
            <div>
              <label className="label">Username *</label>
              <input className="input" value={userForm.username} onChange={setUser('username')} required />
            </div>
            <div>
              <label className="label">ชื่อแสดงผล</label>
              <input className="input" value={userForm.full_name} onChange={setUser('full_name')} />
            </div>
            <div>
              <label className="label">Password *</label>
              <input type="password" className="input" value={userForm.password} onChange={setUser('password')}
                required minLength={8} placeholder="อย่างน้อย 8 ตัวอักษร" />
            </div>
            <div>
              <label className="label">Role *</label>
              <select className="input" value={userForm.role} onChange={setUser('role')}>
                <option value="ADMIN">ADMIN</option>
                <option value="REVIEWER">REVIEWER</option>
                <option value="OPERATOR">OPERATOR</option>
              </select>
            </div>
            <div className="md:col-span-4 flex justify-end">
              <button type="submit" className="btn-primary" disabled={createUserMutation.isPending}>
                เพิ่มผู้ใช้
              </button>
            </div>
          </form>

          <div className="overflow-x-auto">
            {isUsersLoading ? (
              <div className="text-sm text-gray-500">กำลังโหลดรายการผู้ใช้...</div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="table-header">Username</th>
                    <th className="table-header">ชื่อ</th>
                    <th className="table-header">Role</th>
                    <th className="table-header text-center">สถานะ</th>
                    <th className="table-header text-center">จัดการ</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className={clsx(!u.is_active && 'opacity-50')}>
                      <td className="table-cell font-mono text-xs">{u.username}</td>
                      <td className="table-cell text-sm">{u.full_name || '-'}</td>
                      <td className="table-cell">
                        <select
                          className="input py-1"
                          value={u.role}
                          onChange={(e) => setUserRole(u, e.target.value as UserRole)}
                        >
                          <option value="ADMIN">ADMIN</option>
                          <option value="REVIEWER">REVIEWER</option>
                          <option value="OPERATOR">OPERATOR</option>
                        </select>
                      </td>
                      <td className="table-cell text-center">
                        <span className={clsx('text-xs font-medium px-2 py-1 rounded-full', {
                          'bg-green-100 text-green-700': u.is_active,
                          'bg-gray-100 text-gray-600': !u.is_active,
                        })}>
                          {u.is_active ? 'ใช้งานอยู่' : 'ปิดใช้งาน'}
                        </span>
                      </td>
                      <td className="table-cell text-center">
                        <button
                          className={clsx('px-2 py-1 rounded text-xs', u.is_active
                            ? 'bg-red-50 text-red-600 hover:bg-red-100'
                            : 'bg-green-50 text-green-700 hover:bg-green-100')}
                          onClick={() => toggleUserActive(u)}
                        >
                          {u.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {isAdmin && (
        <div className="card p-5 space-y-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold text-gray-900">เลือกผู้ใช้จาก HOSxP</h3>
              <p className="text-sm text-gray-500">ระบุเฉพาะผู้ใช้ HOSxP ที่อนุญาตให้เข้าใช้งานระบบ แล้วกด Sync เพื่ออัปเดต user ในระบบนี้</p>
            </div>
            <button
              type="button"
              className="btn-primary"
              disabled={syncHosxpMutation.isPending}
              onClick={() => syncHosxpMutation.mutate()}
            >
              {syncHosxpMutation.isPending ? 'กำลัง Sync...' : 'Sync จากรายการที่เลือก'}
            </button>
          </div>

          <form onSubmit={handleCreateHosxpSelection} className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
            <div>
              <label className="label">HOSxP Username *</label>
              <input className="input" value={hosxpForm.hosxp_username} onChange={setHosxp('hosxp_username')} required />
            </div>
            <div>
              <label className="label">ชื่อแสดงผล</label>
              <input className="input" value={hosxpForm.full_name} onChange={setHosxp('full_name')} />
            </div>
            <div>
              <label className="label">Role *</label>
              <select className="input" value={hosxpForm.role} onChange={setHosxp('role')}>
                <option value="ADMIN">ADMIN</option>
                <option value="REVIEWER">REVIEWER</option>
                <option value="OPERATOR">OPERATOR</option>
              </select>
            </div>
            <label className="inline-flex items-center gap-2 text-sm text-gray-700 h-10">
              <input type="checkbox" checked={hosxpForm.is_active} onChange={setHosxp('is_active')} />
              เปิดใช้งาน
            </label>
            <div className="flex justify-end">
              <button type="submit" className="btn-secondary" disabled={createHosxpSelectionMutation.isPending}>
                เพิ่มรายการ
              </button>
            </div>
          </form>

          <div className="overflow-x-auto">
            {isHosxpLoading ? (
              <div className="text-sm text-gray-500">กำลังโหลดรายการ HOSxP...</div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="table-header">HOSxP Username</th>
                    <th className="table-header">ชื่อ</th>
                    <th className="table-header">Role</th>
                    <th className="table-header">สถานะ</th>
                    <th className="table-header">Sync ล่าสุด</th>
                    <th className="table-header text-center">จัดการ</th>
                  </tr>
                </thead>
                <tbody>
                  {hosxpSelections.map((item) => (
                    <tr key={item.id} className={clsx(!item.is_active && 'opacity-50')}>
                      <td className="table-cell font-mono text-xs">{item.hosxp_username}</td>
                      <td className="table-cell text-sm">{item.full_name || '-'}</td>
                      <td className="table-cell">
                        <select
                          className="input py-1"
                          value={item.role}
                          onChange={(e) => setHosxpRole(item, e.target.value as UserRole)}
                        >
                          <option value="ADMIN">ADMIN</option>
                          <option value="REVIEWER">REVIEWER</option>
                          <option value="OPERATOR">OPERATOR</option>
                        </select>
                      </td>
                      <td className="table-cell text-xs">{item.is_active ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}</td>
                      <td className="table-cell text-xs text-gray-600">
                        {item.last_synced_at ? new Date(item.last_synced_at).toLocaleString('th-TH') : '-'}
                      </td>
                      <td className="table-cell text-center">
                        <button
                          type="button"
                          className={clsx('px-2 py-1 rounded text-xs', item.is_active
                            ? 'bg-red-50 text-red-600 hover:bg-red-100'
                            : 'bg-green-50 text-green-700 hover:bg-green-100')}
                          onClick={() => toggleHosxpSelectionActive(item)}
                        >
                          {item.is_active ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {isAdmin && (
        <div className="card p-5">
          <h3 className="font-semibold text-gray-900">ประวัติการเปลี่ยนแปลงสิทธิ์และบัญชี</h3>
          <p className="text-sm text-gray-500 mb-4">Audit Log ล่าสุดจากระบบ</p>

          {isAuditLoading ? (
            <div className="text-sm text-gray-500">กำลังโหลดประวัติ...</div>
          ) : auditLogs.length === 0 ? (
            <div className="text-sm text-gray-500">ยังไม่มีประวัติการเปลี่ยนแปลง</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="table-header">เวลา</th>
                    <th className="table-header">Actor</th>
                    <th className="table-header">Target</th>
                    <th className="table-header">Action</th>
                    <th className="table-header">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.map((log: UserAuditLog) => (
                    <tr key={log.id}>
                      <td className="table-cell text-xs text-gray-600">
                        {new Date(log.created_at).toLocaleString('th-TH')}
                      </td>
                      <td className="table-cell text-xs">#{log.actor_user_id}</td>
                      <td className="table-cell text-xs">{log.target_user_id ? `#${log.target_user_id}` : '-'}</td>
                      <td className="table-cell text-xs font-mono">{log.action}</td>
                      <td className="table-cell text-xs text-gray-600">{log.detail || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      </>)}
    </div>
  )
}
