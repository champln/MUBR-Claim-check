import { useLocation, useNavigate } from 'react-router-dom'
import { clearSession, getAuthUser } from '../../lib/session'

const PAGE_TITLES: Record<string, { title: string; subtitle: string }> = {
  '/': { title: 'แดชบอร์ด', subtitle: 'ภาพรวมระบบ Pre-screen ข้อมูลส่งเบิก' },
  '/upload': { title: 'นำเข้าข้อมูล', subtitle: 'อัปโหลดไฟล์ Excel/CSV เพื่อตรวจสอบ' },
  '/batches': { title: 'รายการส่งเบิก', subtitle: 'รายการ Batch ทั้งหมดที่นำเข้าระบบ' },
  '/reports': { title: 'รายงาน', subtitle: 'ส่งออกและวิเคราะห์ผลการตรวจสอบ' },
  '/account': { title: 'บัญชีผู้ใช้งาน', subtitle: 'จัดการรหัสผ่านและข้อมูลบัญชีของคุณ' },
  '/settings': { title: 'ตั้งค่ากฎการตรวจสอบ', subtitle: 'จัดการกฎ Validation ที่กำหนดเอง' },
}

export default function Header() {
  const location = useLocation()
  const navigate = useNavigate()
  const path = location.pathname
  const info = PAGE_TITLES[path] || PAGE_TITLES['/']
  const user = getAuthUser()

  const now = new Date()
  const dateStr = now.toLocaleDateString('th-TH', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  })

  const onLogout = () => {
    clearSession()
    navigate('/login', { replace: true })
  }

  return (
    <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
      <div>
        <h1 className="text-lg font-bold text-gray-900">{info.title}</h1>
        <p className="text-sm text-gray-500">{info.subtitle}</p>
      </div>
      <div className="text-right">
        <p className="text-xs text-gray-500">{dateStr}</p>
        <p className="text-xs text-blue-700 font-medium mt-0.5">
          ศูนย์การแพทย์มหิดลบำรุงรักษ์
        </p>
        <p className="text-xs text-gray-500 mt-1">
          {user?.full_name || user?.username || '-'} ({user?.role || '-'})
        </p>
        <button
          type="button"
          onClick={onLogout}
          className="text-xs text-red-600 hover:text-red-700 mt-1"
        >
          ออกจากระบบ
        </button>
      </div>
    </header>
  )
}
