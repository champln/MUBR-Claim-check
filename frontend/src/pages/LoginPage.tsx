import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Activity } from 'lucide-react'
import { login } from '../lib/api'
import { saveSession } from '../lib/session'

export default function LoginPage() {
  const navigate = useNavigate()
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('admin1234')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    try {
      const res = await login({ username, password })
      saveSession(res.access_token, res.user)
      toast.success('เข้าสู่ระบบสำเร็จ')
      navigate('/', { replace: true })
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || 'เข้าสู่ระบบไม่สำเร็จ')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl shadow-xl bg-white border border-slate-200">
        <div className="p-6 border-b border-slate-200">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-11 h-11 rounded-xl bg-blue-900 text-white flex items-center justify-center">
              <Activity className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900">MUBR Claim</h1>
              <p className="text-xs text-slate-500">Pre-screen System</p>
            </div>
          </div>
          <p className="text-sm text-slate-600">เข้าสู่ระบบเพื่อใช้งานระบบตรวจสอบข้อมูลส่งเบิก</p>
        </div>

        <form className="p-6 space-y-4" onSubmit={onSubmit}>
          <div>
            <label className="label">Username</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="input"
              autoComplete="username"
              required
            />
          </div>
          <div>
            <label className="label">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input"
              autoComplete="current-password"
              required
            />
          </div>
          <button type="submit" className="btn-primary w-full justify-center" disabled={isSubmitting}>
            {isSubmitting ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
          </button>
        </form>
      </div>
    </div>
  )
}
