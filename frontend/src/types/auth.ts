export type UserRole = 'ADMIN' | 'REVIEWER' | 'OPERATOR'

export interface AuthUser {
  id: number
  username: string
  full_name?: string
  role: UserRole
  is_active: boolean
  created_at: string
}

export interface LoginResponse {
  access_token: string
  token_type: 'bearer'
  user: AuthUser
}

export interface CreateUserRequest {
  username: string
  full_name?: string
  password: string
  role: UserRole
}

export interface UpdateUserRequest {
  full_name?: string
  role?: UserRole
  is_active?: boolean
  password?: string
}

export interface ChangePasswordRequest {
  current_password: string
  new_password: string
}

export interface UserAuditLog {
  id: number
  actor_user_id: number
  target_user_id?: number
  action: string
  detail?: string
  created_at: string
}

export interface HosxpUserSelection {
  id: number
  hosxp_username: string
  full_name?: string
  role: UserRole
  is_active: boolean
  selected_by_user_id?: number
  selected_at: string
  last_synced_at?: string
}

export interface CreateHosxpUserSelectionRequest {
  hosxp_username: string
  full_name?: string
  role: UserRole
  is_active: boolean
}

export interface UpdateHosxpUserSelectionRequest {
  full_name?: string
  role?: UserRole
  is_active?: boolean
}

export interface HosxpSyncResult {
  created_users: number
  updated_users: number
  deactivated_users: number
}

export type HosxpDbType = 'postgresql' | 'mysql'

export interface HosxpConnectionConfig {
  id: number
  // แยกช่องแบบหน้าจอเชื่อมต่อของ HOSxP — API ไม่ส่งรหัสผ่านกลับมา บอกแค่ว่ามีบันทึกไว้
  db_type?: HosxpDbType | string
  host?: string
  port?: number
  database?: string
  db_username?: string
  has_password: boolean
  user_table?: string
  username_column?: string
  full_name_column?: string
  active_column?: string
  password_column?: string
  auth_method?: string
  is_enabled: boolean
  updated_by_user_id?: number
  updated_at: string
}

export interface HosxpConnectionConfigUpsertRequest {
  db_type: HosxpDbType
  host: string
  port?: number
  database: string
  db_username: string
  db_password?: string     // ว่าง = ใช้รหัสผ่านที่บันทึกไว้เดิม
  user_table?: string
  username_column?: string
  full_name_column?: string
  active_column?: string
  password_column?: string
  auth_method?: string
  is_enabled: boolean
}

export interface HosxpDetectAuthResult {
  password_column: string
  auth_method: string
  saved: boolean
}

export interface HosxpUserCandidate {
  hosxp_username: string
  full_name?: string
  is_active: boolean
  already_selected: boolean
  selected_active: boolean
}

export interface HosxpSelectionBulkItem {
  hosxp_username: string
  full_name?: string
  role: UserRole
  is_active: boolean
}

export interface HosxpSelectionBulkUpsertRequest {
  items: HosxpSelectionBulkItem[]
}

export interface HosxpSelectionBulkUpsertResult {
  created: number
  updated: number
}
