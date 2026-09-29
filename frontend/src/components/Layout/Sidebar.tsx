import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, Upload, ClipboardList, BarChart3, Settings, SlidersHorizontal, Activity, UserCog, FileSearch, Wand2, Radio, Biohazard, HeartPulse, Pill, Stethoscope, Receipt, CalendarClock, CalendarCheck, BookOpen, FileCheck2
} from 'lucide-react'
import clsx from 'clsx'
import { getAuthUser } from '../../lib/session'

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'แดชบอร์ด' },
  { to: '/upload', icon: Upload, label: 'นำเข้าข้อมูล' },
  { to: '/live-prescreen', icon: Radio, label: 'Pre-screen สด' },
  { to: '/batches', icon: ClipboardList, label: 'รายการส่งเบิก' },
  { to: '/claim-files', icon: FileSearch, label: 'ตรวจไฟล์ส่งเบิก' },
  { to: '/cpap-fix', icon: Wand2, label: 'แก้ไฟล์ CPAP/PSG' },
  { to: '/covid19-fix', icon: Biohazard, label: 'แก้ไฟล์ COVID-19' },
  { to: '/rama-sh50', icon: HeartPulse, label: 'เติมข้อมูล ปกส.รามา SH50' },
  { to: '/tmt-fix', icon: Pill, label: 'แก้ไขรหัส TMT ยา' },
  { to: '/stdcode-fix', icon: Stethoscope, label: 'แก้รหัสหัตถการ (S19/S41)' },
  { to: '/opd-fee-fix', icon: Receipt, label: 'แก้ยอดค่าบริการ (A04/T33/45)' },
  { to: '/svdate-fix', icon: CalendarClock, label: 'แก้วันที่ให้บริการ (T42)' },
  { to: '/cipn-daterev', icon: CalendarCheck, label: 'แก้ DateRev ผู้ป่วยใน' },
  { to: '/cipn-fix', icon: FileCheck2, label: 'ตรวจ/แก้ ClaimCat ผู้ป่วยใน' },
  { to: '/reports', icon: BarChart3, label: 'รายงาน' },
  { to: '/account', icon: UserCog, label: 'บัญชีผู้ใช้' },
  { to: '/help', icon: BookOpen, label: 'วิธีใช้งาน' },
]

export default function Sidebar() {
  const user = getAuthUser()
  const canManageRules = user?.role === 'ADMIN' || user?.role === 'REVIEWER'
  const isAdmin = user?.role === 'ADMIN'
  const items = [
    ...navItems,
    ...(canManageRules ? [{ to: '/settings', icon: SlidersHorizontal, label: 'ตั้งค่ากฎการตรวจสอบ' }] : []),
    ...(isAdmin ? [{ to: '/system-settings', icon: Settings, label: 'ตั้งค่าระบบ' }] : []),
  ]

  return (
    <aside className="w-60 min-h-screen bg-blue-900 text-white flex flex-col shadow-xl">
      {/* Logo / Header */}
      <div className="px-5 py-6 border-b border-blue-800">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center">
            <Activity className="w-6 h-6 text-blue-800" />
          </div>
          <div>
            <p className="font-bold text-sm leading-tight">MUBR Claim</p>
            <p className="text-xs text-blue-300 leading-tight">Pre-screen System</p>
          </div>
        </div>
        <p className="text-xs text-blue-400 mt-3 leading-snug">
          ศูนย์การแพทย์มหิดลบำรุงรักษ์<br />จังหวัดนครสวรรค์
        </p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {items.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              clsx(
                'flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-all',
                isActive
                  ? 'bg-white text-blue-900 shadow'
                  : 'text-blue-200 hover:bg-blue-800 hover:text-white'
              )
            }
          >
            <Icon className="w-5 h-5" />
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-blue-800">
        <p className="text-xs text-blue-400">v1.0.0 &copy; 2568</p>
      </div>
    </aside>
  )
}
