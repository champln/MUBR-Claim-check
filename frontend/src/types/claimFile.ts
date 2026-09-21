export type ClaimFundType =
  | 'SSS_OPD'
  | 'SSS_IPD'
  | 'CSMBS_OPD'
  | 'CSMBS_IPD'
  | 'LGO'
  | 'OTHER'

export const FUND_TYPE_LABELS: Record<ClaimFundType, string> = {
  SSS_OPD: 'ประกันสังคม OPD',
  SSS_IPD: 'ประกันสังคม IPD (AIPN)',
  CSMBS_OPD: 'ข้าราชการ OPD',
  CSMBS_IPD: 'ข้าราชการ IPD',
  LGO: 'อปท. Eclaim',
  OTHER: 'อื่นๆ',
}

export type ClaimFileSessionStatus = 'PROCESSING' | 'COMPLETED' | 'FAILED'

export interface ClaimFileSession {
  id: number
  session_name: string
  fund_type: ClaimFundType
  period_month: number | null
  period_year: number | null
  files_info: string | null   // JSON string
  total_records: number
  error_count: number
  warning_count: number
  status: ClaimFileSessionStatus
  created_at: string
  has_source?: boolean      // แก้ไขระดับฟิลด์ + เซ็น MD5 ได้ไหม
  pending_edits?: number    // จำนวนช่องที่แก้ค้างไว้
}

export interface ClaimIssue {
  code: string
  field: string
  message: string
  severity: 'ERROR' | 'WARNING'
}

export interface ClaimFileRecord {
  id: number
  session_id: number
  visit_no: string | null
  hn: string | null
  cid: string | null
  patient_name: string | null
  visit_date: string | null
  discharge_date: string | null
  pdx: string | null
  total_charge: number
  claim_amount: number
  copay_amount: number
  raw_data: string | null     // JSON string
  issues: string | null       // JSON string
  has_error: boolean
  has_warning: boolean
  is_edited: boolean
  edited_data: string | null  // JSON string
}
