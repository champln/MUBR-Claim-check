import { useLocation } from 'react-router-dom'

const PAGE_TITLES: Record<string, { title: string; subtitle: string }> = {
  '/': { title: 'แดชบอร์ด', subtitle: 'ภาพรวมระบบ Pre-screen ข้อมูลส่งเบิก' },
  '/upload': { title: 'นำเข้าข้อมูล', subtitle: 'อัปโหลดไฟล์ Excel/CSV เพื่อตรวจสอบ' },
  '/batches': { title: 'รายการส่งเบิก', subtitle: 'รายการ Batch ทั้งหมดที่นำเข้าระบบ' },
  '/reports': { title: 'รายงาน', subtitle: 'ส่งออกและวิเคราะห์ผลการตรวจสอบ' },
  '/settings': { title: 'ตั้งค่ากฎการตรวจสอบ', subtitle: 'จัดการกฎ Validation ที่กำหนดเอง' },
}

export default function Header() {
  const location = useLocation()
  const path = location.pathname
  const info = PAGE_TITLES[path] || PAGE_TITLES['/']

  const now = new Date()
  const dateStr = now.toLocaleDateString('th-TH', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  })

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
      </div>
    </header>
  )
}
