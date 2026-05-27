import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, Upload, ClipboardList, BarChart3, Settings, Activity
} from 'lucide-react'
import clsx from 'clsx'

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'แดชบอร์ด' },
  { to: '/upload', icon: Upload, label: 'นำเข้าข้อมูล' },
  { to: '/batches', icon: ClipboardList, label: 'รายการส่งเบิก' },
  { to: '/reports', icon: BarChart3, label: 'รายงาน' },
  { to: '/settings', icon: Settings, label: 'ตั้งค่ากฎ' },
]

export default function Sidebar() {
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
        {navItems.map(({ to, icon: Icon, label }) => (
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
