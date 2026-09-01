export interface CpapFileStatus {
  name: string
  checksum_valid: boolean | null
}

export type ClaimType = 'CPAP' | 'PSG' | null

export interface CpapBillItem {
  code: string
  name: string
  amount: string
  is_cpap: boolean
  claim_type?: ClaimType
}

export interface CpapVisitCurrent {
  authcode: string
  class: string
  doctor: string
  svpid: string
}

export interface CpapVisit {
  visit_no: string
  invno?: string
  vn?: string
  patient_name?: string
  claim_type?: ClaimType
  doctor_target?: string
  doctor_name?: string
  items: CpapBillItem[]
  current: CpapVisitCurrent
  needs_fix: boolean
}

export interface CpapAnalyzeResult {
  files: CpapFileStatus[]
  pay_plan: string
  sessno: string
  service_date: string
  fiscal_year: number | null
  doctor_target: string
  cpap_visits: CpapVisit[]
  needs_fix: boolean
}

export interface CpapFixSession {
  id: number
  session_name: string
  fiscal_year: number | null
  claim_types: string | null
  pay_plan: string | null
  service_date: string | null
  visit_count: number
  file_count: number
  auth_codes: string | null
  changes: string | null
  visits_info: string | null
  files_info: string | null
  result_filename: string | null
  created_at: string
}

export interface FiscalYearCount {
  fiscal_year: number | null
  count: number
}
