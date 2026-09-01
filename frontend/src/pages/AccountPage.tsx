import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { changePassword } from '../lib/api'

type PasswordForm = {
  current_password: string
  new_password: string
  confirm_password: string
}

const EMPTY_FORM: PasswordForm = {
  current_password: '',
  new_password: '',
  confirm_password: '',
}

export default function AccountPage() {
  const [form, setForm] = useState<PasswordForm>(EMPTY_FORM)

  const mutation = useMutation({
    mutationFn: changePassword,
    onSuccess: () => {
      toast.success('เปลี่ยนรหัสผ่านเรียบร้อยแล้ว')
      setForm(EMPTY_FORM)
    },
    onError: (e: any) => toast.error(e.response?.data?.detail || 'เกิดข้อผิดพลาด'),
  })

  const set = (k: keyof PasswordForm) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (form.new_password !== form.confirm_password) {
      toast.error('รหัสผ่านใหม่และยืนยันรหัสผ่านไม่ตรงกัน')
      return
    }
    mutation.mutate({
      current_password: form.current_password,
      new_password: form.new_password,
    })
  }

  return (
    <div className="max-w-xl space-y-6">
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-gray-900">เปลี่ยนรหัสผ่าน</h2>
        <p className="text-sm text-gray-500 mt-1">
          นโยบายรหัสผ่าน: อย่างน้อย 8 ตัวอักษร, มีตัวพิมพ์ใหญ่, ตัวพิมพ์เล็ก และตัวเลข
        </p>

        <form className="space-y-4 mt-5" onSubmit={onSubmit}>
          <div>
            <label className="label">รหัสผ่านปัจจุบัน</label>
            <input type="password" className="input" value={form.current_password} onChange={set('current_password')} required />
          </div>
          <div>
            <label className="label">รหัสผ่านใหม่</label>
            <input type="password" className="input" value={form.new_password} onChange={set('new_password')} required minLength={8} />
          </div>
          <div>
            <label className="label">ยืนยันรหัสผ่านใหม่</label>
            <input type="password" className="input" value={form.confirm_password} onChange={set('confirm_password')} required minLength={8} />
          </div>
          <div className="flex justify-end">
            <button type="submit" className="btn-primary" disabled={mutation.isPending}>
              {mutation.isPending ? 'กำลังบันทึก...' : 'บันทึกรหัสผ่านใหม่'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
