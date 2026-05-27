// Claim types
export type ClaimType = 'SSO' | 'CSMBS' | 'UC' | 'LGW' | 'ECLAIM' | 'OPD_SELF' | 'OTHER'
export type ClaimStatus = 'PENDING' | 'PASSED' | 'FAILED' | 'FLAGGED_C' | 'CORRECTED' | 'REJECTED'
export type BatchStatus = 'PROCESSING' | 'COMPLETED' | 'FAILED'
export type ErrorSeverity = 'ERROR' | 'WARNING' | 'INFO'

export interface ClaimBatch {
  id: number
  batch_no: string
  filename: string
  claim_type: ClaimType
  period_month?: number
  period_year?: number
  total_records: number
  passed_records: number
  failed_records: number
  flagged_records: number
  total_amount: number
  status: BatchStatus
  uploaded_by?: string
  note?: string
  created_at: string
}

export interface PreScreenError {
  id: number
  claim_id: number
  error_code: string
  error_category?: string
  error_field?: string
  error_message: string
  error_message_th?: string
  current_value?: string
  expected_value?: string
  severity: ErrorSeverity
  is_resolved: boolean
  resolved_note?: string
}

export interface ClaimRecord {
  id: number
  batch_id: number
  row_number?: number
  hn?: string
  pid?: string
  patient_name?: string
  dob?: string
  age?: number
  visit_date?: string
  discharge_date?: string
  visit_type?: string
  los?: number
  ward?: string
  claim_type?: ClaimType
  claim_no?: string
  insurance_id?: string
  pdx?: string
  adx1?: string
  adx2?: string
  adx3?: string
  adx4?: string
  op1?: string
  op2?: string
  op3?: string
  drg_code?: string
  rw?: number
  adjrw?: number
  total_charge: number
  claim_amount: number
  drug_amount: number
  supply_amount: number
  service_amount: number
  copay_amount: number
  status: ClaimStatus
  is_flagged_c: boolean
  flag_reason?: string
  errors: PreScreenError[]
  created_at: string
}

export interface PreScreenSummary {
  batch_id: number
  total: number
  passed: number
  failed: number
  flagged_c: number
  warnings: number
  error_categories: Record<string, number>
  top_errors: Array<{ code: string; count: number; message_th: string }>
  total_amount: number
  claim_amount: number
}

export interface DashboardStats {
  total_batches: number
  total_claims: number
  total_passed: number
  total_failed: number
  total_flagged_c: number
  total_amount: number
  recent_batches: ClaimBatch[]
  monthly_summary: Array<{
    year?: number
    month?: number
    total: number
    passed: number
    failed: number
  }>
  error_type_summary: Array<{ category: string; count: number }>
}

export interface ValidationRule {
  id: number
  rule_code: string
  rule_name: string
  rule_name_th?: string
  category: string
  claim_type?: ClaimType
  condition_type: string
  condition_value?: string
  severity: ErrorSeverity
  is_active: boolean
  description?: string
  created_at: string
}

export const CLAIM_TYPE_LABELS: Record<ClaimType, string> = {
  SSO: 'ประกันสังคม (SSO)',
  CSMBS: 'สวัสดิการข้าราชการ (CSMBS)',
  UC: 'บัตรทอง/UC',
  LGW: 'พนักงานส่วนท้องถิ่น',
  ECLAIM: 'E-Claim',
  OPD_SELF: 'ชำระเอง',
  OTHER: 'อื่นๆ',
}

export const STATUS_LABELS: Record<ClaimStatus, string> = {
  PENDING: 'รอตรวจสอบ',
  PASSED: 'ผ่าน',
  FAILED: 'ไม่ผ่าน',
  FLAGGED_C: 'ติด C',
  CORRECTED: 'แก้ไขแล้ว',
  REJECTED: 'ปฏิเสธ',
}

export const ERROR_CATEGORY_LABELS: Record<string, string> = {
  DOC: 'ความครบถ้วนเอกสาร',
  ICD: 'รหัส ICD-10/ICD-9',
  C_FLAG: 'ติด C Flag',
  DATE: 'วันที่/ระยะเวลา',
  AMOUNT: 'จำนวนเงิน',
  DRG: 'DRG/RW',
  RIGHTS: 'สิทธิ์การรักษา',
  DRUG: 'ยาและเวชภัณฑ์',
  CUSTOM: 'กฎกำหนดเอง',
}

export const MONTHS_TH = [
  '', 'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
]
