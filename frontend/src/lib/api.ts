import axios from 'axios'
import type {
  ClaimBatch, ClaimRecord, DashboardStats, PreScreenSummary, ValidationRule
} from '../types/claim'

const api = axios.create({
  baseURL: '/api',
  timeout: 60000,
})

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
