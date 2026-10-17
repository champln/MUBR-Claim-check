import { NavLink } from 'react-router-dom'
import { Stethoscope, BedDouble } from 'lucide-react'
import clsx from 'clsx'

// สลับ Pre-screen สด ผู้ป่วยนอก / ผู้ป่วยใน — แต่ละหน้าดึงข้อมูลเฉพาะของตัวเอง
export default function LiveTabs() {
  const tabs = [
    { to: '/live-prescreen', label: 'ผู้ป่วยนอก (OPD)', icon: Stethoscope },
    { to: '/live-prescreen-ipd', label: 'ผู้ป่วยใน (IPD)', icon: BedDouble },
  ]
  return (
    <div className="flex gap-1 border-b border-gray-200">
      {tabs.map(({ to, label, icon: Icon }) => (
        <NavLink key={to} to={to} end
          className={({ isActive }) => clsx(
            'inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
            isActive ? 'border-blue-600 text-blue-700' : 'border-transparent text-gray-500 hover:text-gray-700',
          )}>
          <Icon className="w-4 h-4" /> {label}
        </NavLink>
      ))}
    </div>
  )
}
