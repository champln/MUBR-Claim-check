import axios from 'axios'
import type {
  ClaimBatch, ClaimRecord, DashboardStats, PreScreenSummary, ValidationRule
} from '../types/claim'
import type { ClaimFileSession, ClaimFileRecord } from '../types/claimFile'
import type { CpapAnalyzeResult, CpapFixSession, FiscalYearCount } from '../types/cpapFix'
import type {
  AuthUser,
  ChangePasswordRequest,
  CreateHosxpUserSelectionRequest,
  CreateUserRequest,
  HosxpConnectionConfig,
  HosxpConnectionConfigUpsertRequest,
  HosxpSelectionBulkUpsertRequest,
  HosxpSelectionBulkUpsertResult,
  HosxpSyncResult,
  HosxpUserCandidate,
  HosxpUserSelection,
  LoginResponse,
  UpdateHosxpUserSelectionRequest,
  UpdateUserRequest,
  UserAuditLog,
} from '../types/auth'
import { clearSession, getAuthToken } from './session'

const api = axios.create({
  baseURL: '/api',
  timeout: 60000,
})

api.interceptors.request.use((config) => {
  const token = getAuthToken()
  if (token) {
    config.headers = config.headers || {}
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// แปลง detail ของ error ให้เป็น "string เสมอ" — กัน react-hot-toast crash (หน้าขาว)
// FastAPI/Pydantic (422) ส่ง detail เป็น array ของ object {type, loc, msg, ...}
function normalizeDetail(detail: unknown): string | undefined {
  if (detail == null) return undefined
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail
      .map((d: any) => {
        const field = Array.isArray(d?.loc) ? d.loc[d.loc.length - 1] : undefined
        const msg = d?.msg || (typeof d === 'string' ? d : JSON.stringify(d))
        return field ? `${field}: ${msg}` : msg
      })
      .join(' · ')
  }
  if (typeof detail === 'object') {
    const d: any = detail
    return d.msg || d.detail || JSON.stringify(d)
  }
  return String(detail)
}

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error?.response?.status === 401) {
      // เซสชันหมดอายุ / token ไม่ถูกต้อง -> ล้าง session แล้วพากลับหน้า login
      clearSession()
      if (window.location.pathname !== '/login') {
        window.location.href = '/login?reason=expired'
      }
    } else if (!error?.response) {
      // ไม่มี response = เชื่อมต่อ backend ไม่ได้ (เซิร์ฟเวอร์อาจไม่ทำงาน)
      error.friendlyMessage = 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — โปรดตรวจสอบว่า backend ทำงานอยู่'
    }
    // normalize detail ให้เป็น string เสมอ (สำคัญ: กัน object ถูกส่งเข้า toast แล้ว crash)
    if (error?.response?.data && typeof error.response.data === 'object') {
      const str = normalizeDetail((error.response.data as any).detail)
      if (str !== undefined) (error.response.data as any).detail = str
    }
    if (!error.friendlyMessage) {
      error.friendlyMessage = (error.response?.data as any)?.detail || 'เกิดข้อผิดพลาด'
    }
    return Promise.reject(error)
  }
)

// ─── Auth ────────────────────────────────────────────────────────────────────

export const login = (data: { username: string; password: string }) =>
  api.post<LoginResponse>('/auth/login', data).then(r => r.data)

export const getMe = () =>
  api.get<AuthUser>('/auth/me').then(r => r.data)

export const getUsers = () =>
  api.get<AuthUser[]>('/auth/users').then(r => r.data)

export const createUser = (data: CreateUserRequest) =>
  api.post<AuthUser>('/auth/users', data).then(r => r.data)

export const updateUser = (id: number, data: UpdateUserRequest) =>
  api.patch<AuthUser>(`/auth/users/${id}`, data).then(r => r.data)

export const changePassword = (data: ChangePasswordRequest) =>
  api.post<{ message: string }>('/auth/change-password', data).then(r => r.data)

export const getAuditLogs = (limit = 100) =>
  api.get<UserAuditLog[]>('/auth/audit-logs', { params: { limit } }).then(r => r.data)

export const getHosxpSelections = () =>
  api.get<HosxpUserSelection[]>('/auth/hosxp-selections').then(r => r.data)

export const createHosxpSelection = (data: CreateHosxpUserSelectionRequest) =>
  api.post<HosxpUserSelection>('/auth/hosxp-selections', data).then(r => r.data)

export const updateHosxpSelection = (id: number, data: UpdateHosxpUserSelectionRequest) =>
  api.patch<HosxpUserSelection>(`/auth/hosxp-selections/${id}`, data).then(r => r.data)

export const syncHosxpSelections = () =>
  api.post<HosxpSyncResult>('/auth/hosxp-selections/sync').then(r => r.data)

export const getHosxpConfig = () =>
  api.get<HosxpConnectionConfig | null>('/auth/hosxp-config').then(r => r.data)

export const upsertHosxpConfig = (data: HosxpConnectionConfigUpsertRequest) =>
  api.put<HosxpConnectionConfig>('/auth/hosxp-config', data).then(r => r.data)

export const detectHosxpAuth = (data: { username: string; password: string }) =>
  api.post<import('../types/auth').HosxpDetectAuthResult>('/auth/hosxp-config/detect-auth', data).then(r => r.data)

export const getHosxpCandidates = (params?: { search?: string; limit?: number }) =>
  api.get<HosxpUserCandidate[]>('/auth/hosxp-users/candidates', { params }).then(r => r.data)

export const bulkUpsertHosxpSelections = (data: HosxpSelectionBulkUpsertRequest) =>
  api.post<HosxpSelectionBulkUpsertResult>('/auth/hosxp-selections/bulk-upsert', data).then(r => r.data)

// ─── Dashboard ───────────────────────────────────────────────────────────────

export const getDashboard = () =>
  api.get<DashboardStats>('/dashboard').then(r => r.data)

// ─── Batches ─────────────────────────────────────────────────────────────────

export const getBatches = (params?: { skip?: number; limit?: number; claim_type?: string }) =>
  api.get<ClaimBatch[]>('/batches/', { params }).then(r => r.data)

export const getBatch = (id: number) =>
  api.get<ClaimBatch>(`/batches/${id}`).then(r => r.data)

export const deleteBatch = (id: number) =>
  api.delete(`/batches/${id}`).then(r => r.data)

// ─── Claims ──────────────────────────────────────────────────────────────────

export const getClaims = (
  batchId: number,
  params?: { skip?: number; limit?: number; status?: string; search?: string }
) => api.get<ClaimRecord[]>(`/batches/${batchId}/claims`, { params }).then(r => r.data)

export const getClaim = (batchId: number, claimId: number) =>
  api.get<ClaimRecord>(`/batches/${batchId}/claims/${claimId}`).then(r => r.data)

// ─── Pre-screen ───────────────────────────────────────────────────────────────

export const uploadAndPrescreen = (formData: FormData) =>
  api.post<ClaimBatch>('/prescreen/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
  }).then(r => r.data)

export const getPrescreenSummary = (batchId: number) =>
  api.get<PreScreenSummary>(`/prescreen/${batchId}/summary`).then(r => r.data)

export const rerunPrescreen = (batchId: number) =>
  api.post<PreScreenSummary>(`/prescreen/${batchId}/rerun`).then(r => r.data)

// ─── Live Pre-screen (ดึงจาก HOSxP สด) ────────────────────────────────────────

export interface LivePrescreenError {
  code: string
  category: string
  field: string
  message_th: string
  severity: 'ERROR' | 'WARNING'
  current_value?: string | null
}

export interface LivePrescreenRecord {
  vn: string
  hn: string | null
  pid: string | null
  patient_name: string | null
  visit_date: string | null
  visit_time: string
  pttype: string
  pdx: string | null
  adx: string[]
  total_charge: number
  status: 'PASSED' | 'FAILED' | 'FLAGGED_C'
  flag_reason: string | null
  errors: LivePrescreenError[]
}

export interface LivePrescreenResult {
  fetched_at: string
  date_from: string
  date_to: string
  pttype: string[] | null
  summary: {
    total: number
    passed: number
    failed: number
    flagged_c: number
    warned: number
    total_amount: number
  }
  records: LivePrescreenRecord[]
}

export interface LivePrescreenStatus {
  configured: boolean
  reachable: boolean
  message: string
}

export const getLivePrescreenStatus = () =>
  api.get<LivePrescreenStatus>('/live-prescreen/status').then(r => r.data)

export const runLivePrescreen = (params: {
  date_from?: string
  date_to?: string
  pttype?: string
  limit?: number
}) =>
  api.get<LivePrescreenResult>('/live-prescreen', { params, timeout: 120000 }).then(r => r.data)

// ─── Reports ─────────────────────────────────────────────────────────────────

export const exportReport = async (batchId: number, batchNo: string) => {
  const res = await api.get(`/reports/${batchId}/export`, { responseType: 'blob' })
  const url = URL.createObjectURL(res.data)
  const a = document.createElement('a')
  a.href = url
  a.download = `prescreen_${batchNo}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Rules ───────────────────────────────────────────────────────────────────

export const getRules = () =>
  api.get<ValidationRule[]>('/rules').then(r => r.data)

export const createRule = (data: Omit<ValidationRule, 'id' | 'is_active' | 'created_at'>) =>
  api.post<ValidationRule>('/rules', data).then(r => r.data)

export const updateRule = (id: number, data: Partial<ValidationRule>) =>
  api.put<ValidationRule>(`/rules/${id}`, data).then(r => r.data)

export const deleteRule = (id: number) =>
  api.delete(`/rules/${id}`).then(r => r.data)

export const toggleRule = (id: number) =>
  api.patch<ValidationRule>(`/rules/${id}/toggle`).then(r => r.data)

// ─── Claim File Check ─────────────────────────────────────────────────────────

export const uploadClaimFiles = (formData: FormData) =>
  api.post<ClaimFileSession>('/claim-files/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
  }).then(r => r.data)

export const getClaimFileSessions = (params?: { skip?: number; limit?: number }) =>
  api.get<ClaimFileSession[]>('/claim-files/', { params }).then(r => r.data)

export const getClaimFileSession = (id: number) =>
  api.get<ClaimFileSession>(`/claim-files/${id}`).then(r => r.data)

export const deleteClaimFileSession = (id: number) =>
  api.delete(`/claim-files/${id}`).then(r => r.data)

export const getClaimFileRecords = (
  sessionId: number,
  params?: { skip?: number; limit?: number; has_error?: boolean; has_warning?: boolean; search?: string }
) => api.get<ClaimFileRecord[]>(`/claim-files/${sessionId}/records`, { params }).then(r => r.data)

export const editClaimFileRecord = (sessionId: number, recordId: number, editedData: Record<string, unknown>) =>
  api.patch<ClaimFileRecord>(`/claim-files/${sessionId}/records/${recordId}`, { edited_data: editedData }).then(r => r.data)

export const exportClaimFileSummary = async (sessionId: number, sessionName: string) => {
  const res = await api.get(`/claim-files/${sessionId}/export-summary`, { responseType: 'blob' })
  const url = URL.createObjectURL(res.data)
  const a = document.createElement('a')
  a.href = url
  a.download = `claim_check_${sessionName}.json`
  a.click()
  URL.revokeObjectURL(url)
}

// ─── CPAP / Sleep test fix (CSOP กรมบัญชีกลาง สกส.) ─────────────────────────────

export const analyzeCpapFiles = (files: File[]) => {
  const fd = new FormData()
  files.forEach(f => fd.append('files', f))
  // อย่าตั้ง Content-Type เอง — ปล่อยให้ browser ใส่ boundary ของ multipart ให้
  return api.post<CpapAnalyzeResult>('/cpap-fix/analyze', fd).then(r => r.data)
}

export const applyCpapFix = async (
  files: File[],
  authCodes: Record<string, string>,
  targetVisits?: string[],
): Promise<{ changes: string[]; sessionId: string | null }> => {
  const fd = new FormData()
  files.forEach(f => fd.append('files', f))
  fd.append('auth_codes', JSON.stringify(authCodes))
  if (targetVisits) fd.append('target_visits', JSON.stringify(targetVisits))

  const res = await api.post('/cpap-fix/apply', fd, {
    responseType: 'blob',
  })

  let changes: string[] = []
  try {
    changes = JSON.parse(res.headers['x-fix-changes'] || '[]')
  } catch { /* ignore */ }

  const filename = res.headers['x-zip-filename'] || 'cpap_fixed.zip'
  const url = URL.createObjectURL(res.data)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)

  return { changes, sessionId: res.headers['x-session-id'] || null }
}

// ─── CPAP fix history ─────────────────────────────────────────────────────────

export const getCpapSessions = (fiscalYear?: number | null, claimType?: string | null) => {
  const params: Record<string, string | number> = {}
  if (fiscalYear != null) params.fiscal_year = fiscalYear
  if (claimType) params.claim_type = claimType
  return api.get<CpapFixSession[]>('/cpap-fix/sessions', { params }).then(r => r.data)
}

export const getCpapFiscalYears = () =>
  api.get<FiscalYearCount[]>('/cpap-fix/fiscal-years').then(r => r.data)

export const deleteCpapSession = (id: number) =>
  api.delete(`/cpap-fix/sessions/${id}`).then(r => r.data)

export const clearCpapSessionsByFiscalYear = (fiscalYear: number) =>
  api.delete('/cpap-fix/sessions', { params: { fiscal_year: fiscalYear } }).then(r => r.data)

export const downloadCpapSession = async (id: number, filename = 'cpap_fixed.zip') => {
  const res = await api.get(`/cpap-fix/sessions/${id}/download`, { responseType: 'blob' })
  const url = URL.createObjectURL(res.data)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ─── COVID-19 fix (BILLTRAN AuthCode = COV-19) ─────────────────────────────────

export interface Covid19PreviewRow {
  invno: string
  hn: string
  patient_name: string
  current_authcode: string
  will_change: boolean
  matched: boolean
}

export interface Covid19PreviewResult {
  billtran_file: string
  checksum_valid: boolean | null
  total_rows: number
  match_count: number
  already_count: number
  will_change_count: number
  target_invno_count: number
  target_hn_count: number
  apply_all: boolean
  rows: Covid19PreviewRow[]
}

export interface Covid19Opts {
  listFile?: File | null
  manualInvnos?: string
  manualHns?: string
  applyAll?: boolean
}

function buildCovid19Form(files: File[], opts: Covid19Opts): FormData {
  const fd = new FormData()
  files.forEach(f => fd.append('files', f))
  if (opts.listFile) fd.append('list_file', opts.listFile)
  if (opts.manualInvnos) fd.append('manual_invnos', opts.manualInvnos)
  if (opts.manualHns) fd.append('manual_hns', opts.manualHns)
  if (opts.applyAll) fd.append('apply_all', 'true')
  return fd
}

export const previewCovid19 = (files: File[], opts: Covid19Opts) =>
  api.post<Covid19PreviewResult>('/covid19-fix/preview', buildCovid19Form(files, opts))
    .then(r => r.data)

export const applyCovid19 = async (
  files: File[],
  opts: Covid19Opts,
): Promise<{ changed: number; changes: string[]; filename: string }> => {
  const res = await api.post('/covid19-fix/apply', buildCovid19Form(files, opts), {
    responseType: 'blob',
  })
  let changes: string[] = []
  try { changes = JSON.parse(res.headers['x-fix-changes'] || '[]') } catch { /* ignore */ }
  const filename = res.headers['x-filename'] || 'BILLTRAN_COV19.txt'
  const url = URL.createObjectURL(res.data)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
  return { changed: Number(res.headers['x-fix-changed'] || 0), changes, filename }
}

// ─── ประกันสังคมรามา SH 50 (BILLTRAN: HMain + OtherPayplan=SH) ─────────────────

export interface RamaSh50Row {
  invno: string
  patient_name: string
  amount: number
  claim_amt: number
  diff: number
  current_hmain: string
  current_otherpayplan: string
  will_fill_hmain: boolean
  will_set_sh: boolean
  excluded: boolean
}

export interface RamaSh50PreviewResult {
  billtran_file: string
  checksum_valid: boolean | null
  hmain_code: string
  sh_amount: string
  total_rows: number
  hmain_fill_count: number
  sh_set_count: number
  excluded_count: number
  rows: RamaSh50Row[]
}

export interface RamaSh50Opts {
  hmain?: string
  shAmount?: string
  excludeInvnos?: string
}

function buildRamaForm(files: File[], opts: RamaSh50Opts): FormData {
  const fd = new FormData()
  files.forEach(f => fd.append('files', f))
  if (opts.hmain) fd.append('hmain', opts.hmain)
  if (opts.shAmount) fd.append('sh_amount', opts.shAmount)
  if (opts.excludeInvnos) fd.append('exclude_invnos', opts.excludeInvnos)
  return fd
}

export const previewRamaSh50 = (files: File[], opts: RamaSh50Opts = {}) =>
  api.post<RamaSh50PreviewResult>('/rama-sh50/preview', buildRamaForm(files, opts))
    .then(r => r.data)

export const applyRamaSh50 = async (
  files: File[],
  opts: RamaSh50Opts = {},
): Promise<{ hmainFilled: number; shSet: number; changes: string[]; filename: string }> => {
  const res = await api.post('/rama-sh50/apply', buildRamaForm(files, opts), {
    responseType: 'blob',
  })
  let changes: string[] = []
  try { changes = JSON.parse(res.headers['x-fix-changes'] || '[]') } catch { /* ignore */ }
  const filename = res.headers['x-filename'] || 'BILLTRAN_SH50.txt'
  const url = URL.createObjectURL(res.data)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
  return {
    hmainFilled: Number(res.headers['x-hmain-filled'] || 0),
    shSet: Number(res.headers['x-sh-set'] || 0),
    changes, filename,
  }
}

// ─── แก้ไขรหัส TMT ยา (BillItems + DispensedItems) ─────────────────────────────

export interface TmtRule {
  new_tmt: string
  old_tmt?: string
  hosdrugcode?: string
}

export interface TmtFixRow {
  file: 'BillItems' | 'DispensedItems'
  invno: string
  hosdrugcode: string
  desc: string
  current_tmt: string
  new_tmt: string
}

export interface TmtPreviewResult {
  billtran_file: string | null
  billdisp_file: string | null
  billitems_change_count: number
  dispitems_change_count: number
  total_change_count: number
  rule_count: number
  rows: TmtFixRow[]
}

export interface TmtFixOpts {
  rules?: TmtRule[]
  listFile?: File | null
}

function buildTmtForm(files: File[], opts: TmtFixOpts): FormData {
  const fd = new FormData()
  files.forEach(f => fd.append('files', f))
  const validRules = (opts.rules || []).filter(r => r.new_tmt && (r.old_tmt || r.hosdrugcode))
  if (validRules.length) fd.append('rules', JSON.stringify(validRules))
  if (opts.listFile) fd.append('list_file', opts.listFile)
  return fd
}

export const previewTmtFix = (files: File[], opts: TmtFixOpts) =>
  api.post<TmtPreviewResult>('/tmt-fix/preview', buildTmtForm(files, opts)).then(r => r.data)

export const applyTmtFix = async (
  files: File[],
  opts: TmtFixOpts,
): Promise<{ billitemsChanged: number; dispitemsChanged: number; changes: string[]; filename: string }> => {
  const res = await api.post('/tmt-fix/apply', buildTmtForm(files, opts), { responseType: 'blob' })
  let changes: string[] = []
  try { changes = JSON.parse(res.headers['x-fix-changes'] || '[]') } catch { /* ignore */ }
  const filename = res.headers['x-filename'] || 'BILLTRAN_TMT.txt'
  const url = URL.createObjectURL(res.data)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
  return {
    billitemsChanged: Number(res.headers['x-billitems-changed'] || 0),
    dispitemsChanged: Number(res.headers['x-dispitems-changed'] || 0),
    changes, filename,
  }
}

// ─── แก้รหัสหัตถการใน OPServices (ติด C รหัส S19 / S41) ────────────────────────

export interface StdCodeRow {
  invno: string
  item_id: string
  local_code: string
  current_stdcode: string
  amount: string
  new_stdcode?: string
  source?: string
  issue: 'S19' | 'S41'
}

export interface StdCodePreviewResult {
  opservices_file: string
  fill_count: number
  replace_count: number
  total_change_count: number
  unresolved_count: number
  rows: StdCodeRow[]
  unresolved: StdCodeRow[]
  learned_map: Record<string, string>
}

export interface StdCodeMapping {
  id: number
  local_code: string
  std_code: string
  description: string
  source: string
  updated_at: string | null
}

export interface StdCodeOpts {
  useFileLearning?: boolean
  replaceExisting?: boolean
  overrides?: Record<string, string>
  saveToLibrary?: boolean
}

function buildStdCodeForm(files: File[], opts: StdCodeOpts): FormData {
  const fd = new FormData()
  files.forEach(f => fd.append('files', f))
  fd.append('use_file_learning', String(opts.useFileLearning !== false))
  fd.append('replace_existing', String(!!opts.replaceExisting))
  const overrides = Object.fromEntries(
    Object.entries(opts.overrides || {}).filter(([k, v]) => k.trim() && String(v).trim()),
  )
  if (Object.keys(overrides).length) fd.append('overrides', JSON.stringify(overrides))
  if (opts.saveToLibrary) fd.append('save_to_library', 'true')
  return fd
}

export const previewStdCodeFix = (files: File[], opts: StdCodeOpts = {}) =>
  api.post<StdCodePreviewResult>('/stdcode-fix/preview', buildStdCodeForm(files, opts)).then(r => r.data)

export const applyStdCodeFix = async (
  files: File[],
  opts: StdCodeOpts = {},
): Promise<{ filled: number; replaced: number; unresolved: number; changes: string[]; filename: string }> => {
  const res = await api.post('/stdcode-fix/apply', buildStdCodeForm(files, opts), { responseType: 'blob' })
  let changes: string[] = []
  try { changes = JSON.parse(res.headers['x-fix-changes'] || '[]') } catch { /* ignore */ }
  const filename = res.headers['x-filename'] || 'OPServices.txt'
  const url = URL.createObjectURL(res.data)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
  return {
    filled: Number(res.headers['x-stdcode-filled'] || 0),
    replaced: Number(res.headers['x-stdcode-replaced'] || 0),
    unresolved: Number(res.headers['x-stdcode-unresolved'] || 0),
    changes, filename,
  }
}

// ─── เติมยอดเบิกค่าบริการทั่วไป ผป.นอก (ติด C รหัส T33 / 45) ─────────────────

export interface OpdFeeRow {
  invno: string
  date: string
  local_code: string
  std_code: string
  desc: string
  amount: string
  current_claimable: string
  current_requested: string
  new_value: string
}

export interface OpdFeePreviewResult {
  billtran_file: string
  total_change_count: number
  rows: OpdFeeRow[]
  codes_used: string[]
}

export interface OpdFeeOpts {
  codes?: string
  amount?: string
}

function buildOpdFeeForm(files: File[], opts: OpdFeeOpts): FormData {
  const fd = new FormData()
  files.forEach(f => fd.append('files', f))
  if (opts.codes?.trim()) fd.append('codes', opts.codes.trim())
  fd.append('amount', opts.amount?.trim() || '')
  return fd
}

export const previewOpdFeeFix = (files: File[], opts: OpdFeeOpts = {}) =>
  api.post<OpdFeePreviewResult>('/opd-fee-fix/preview', buildOpdFeeForm(files, opts)).then(r => r.data)

export const applyOpdFeeFix = async (
  files: File[],
  opts: OpdFeeOpts = {},
): Promise<{ rowsChanged: number; changes: string[]; filename: string }> => {
  const res = await api.post('/opd-fee-fix/apply', buildOpdFeeForm(files, opts), { responseType: 'blob' })
  let changes: string[] = []
  try { changes = JSON.parse(res.headers['x-fix-changes'] || '[]') } catch { /* ignore */ }
  const filename = res.headers['x-filename'] || 'BILLTRAN.txt'
  const url = URL.createObjectURL(res.data)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
  return { rowsChanged: Number(res.headers['x-rows-changed'] || 0), changes, filename }
}

// ─── แก้วันที่ให้บริการใน BillItems (ติด C รหัส T42) ──────────────────────────

export interface SvDateRow {
  invno: string
  desc: string
  local_code: string
  std_code: string
  amount: string
  current_date: string
  visit_date: string
}

export interface SvDatePreviewResult {
  billtran_file: string
  total_change_count: number
  rows: SvDateRow[]
  other_mismatches: { file: string; invno: string; date: string; visit_date: string }[]
  visit_dates: Record<string, string>
}

function buildSvDateForm(files: File[], forceDate?: string): FormData {
  const fd = new FormData()
  files.forEach(f => fd.append('files', f))
  fd.append('force_date', forceDate?.trim() || '')
  return fd
}

export const previewSvDateFix = (files: File[], forceDate?: string) =>
  api.post<SvDatePreviewResult>('/svdate-fix/preview', buildSvDateForm(files, forceDate)).then(r => r.data)

export const applySvDateFix = async (
  files: File[],
  forceDate?: string,
): Promise<{ rowsChanged: number; changes: string[]; filename: string }> => {
  const res = await api.post('/svdate-fix/apply', buildSvDateForm(files, forceDate), { responseType: 'blob' })
  let changes: string[] = []
  try { changes = JSON.parse(res.headers['x-fix-changes'] || '[]') } catch { /* ignore */ }
  const filename = res.headers['x-filename'] || 'BILLTRAN.txt'
  const url = URL.createObjectURL(res.data)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
  return { rowsChanged: Number(res.headers['x-rows-changed'] || 0), changes, filename }
}

export const listStdCodeLibrary = () =>
  api.get<StdCodeMapping[]>('/stdcode-fix/library').then(r => r.data)

export const saveStdCodeLibrary = (
  items: { local_code: string; std_code: string; description?: string; source?: string }[],
) => api.post<{ saved: number; total: number }>('/stdcode-fix/library', items).then(r => r.data)

export const deleteStdCodeMapping = (id: number) =>
  api.delete(`/stdcode-fix/library/${id}`).then(r => r.data)
