import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, Upload, ClipboardList, BarChart3, Settings, SlidersHorizontal, Activity,
  UserCog, FileSearch, Wand2, Radio, Biohazard, HeartPulse, Pill, Stethoscope, Receipt,
  CalendarClock, CalendarCheck, BookOpen, FileCheck2, ChevronDown,
} from 'lucide-react'
import clsx from 'clsx'
import { getAuthUser } from '../../lib/session'

type Item = { to: string; icon: any; label: string }
type Group = { title: string; note?: string; items: Item[] }

// เมนูแบ่งตามลักษณะงาน — แยกการแก้ไฟล์ผู้ป่วยนอกกับผู้ป่วยในออกจากกัน
// เพราะสองแบบนี้คนละแฟ้ม คนละวิธีเซ็นไฟล์ และมักคนละคนทำ
const GROUPS: Group[] = [
  {
    title: 'ภาพรวม',
    items: [
      { to: '/', icon: LayoutDashboard, label: 'แดชบอร์ด' },
      { to: '/upload', icon: Upload, label: 'นำเข้าข้อมูล' },
      { to: '/live-prescreen', icon: Radio, label: 'Pre-screen สด' },
      { to: '/batches', icon: ClipboardList, label: 'รายการส่งเบิก' },
      { to: '/claim-files', icon: FileSearch, label: 'ตรวจไฟล์ส่งเบิก' },
    ],
  },
  {
    title: 'แก้ไฟล์ผู้ป่วยนอก',
    note: 'BILLTRAN · BILLDISP · OPServices',
    items: [
      { to: '/stdcode-fix', icon: Stethoscope, label: 'รหัสหัตถการ (S19/S41)' },
      { to: '/opd-fee-fix', icon: Receipt, label: 'ยอดค่าบริการ (A04/T33/45)' },
      { to: '/svdate-fix', icon: CalendarClock, label: 'วันที่ให้บริการ (T42)' },
      { to: '/tmt-fix', icon: Pill, label: 'รหัส TMT ยา' },
      { to: '/rama-sh50', icon: HeartPulse, label: 'ปกส.รามา SH50' },
      { to: '/covid19-fix', icon: Biohazard, label: 'COVID-19' },
      { to: '/cpap-fix', icon: Wand2, label: 'CPAP / PSG' },
    ],
  },
  {
    title: 'แก้ไฟล์ผู้ป่วยใน',
    note: 'CIPN · AIPN (.xml)',
    items: [
      { to: '/cipn-fix', icon: FileCheck2, label: 'ClaimCat และยอดรวม (30/35/36)' },
      { to: '/cipn-daterev', icon: CalendarCheck, label: 'DateRev และค่า HMAC (22)' },
    ],
  },
]

const FOOTER_ITEMS: Item[] = [
  { to: '/reports', icon: BarChart3, label: 'รายงาน' },
  { to: '/account', icon: UserCog, label: 'บัญชีผู้ใช้' },
  { to: '/help', icon: BookOpen, label: 'วิธีใช้งาน' },
]

const COLLAPSE_KEY = 'mubr_sidebar_collapsed'

function isActivePath(pathname: string, to: string): boolean {
  return to === '/' ? pathname === '/' : pathname === to || pathname.startsWith(to + '/')
}

function loadCollapsed(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '{}')
  } catch {
    return {}
  }
}

export default function Sidebar() {
  const location = useLocation()
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(loadCollapsed)

  useEffect(() => {
    try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(collapsed)) } catch { /* โหมดส่วนตัวเขียนไม่ได้ ไม่เป็นไร */ }
  }, [collapsed])

  // ย้ายไปหน้าที่อยู่ในกลุ่มที่พับไว้ -> กางกลุ่มนั้นให้ (ทำงานตอนเปลี่ยนหน้าเท่านั้น
  // จึงไม่ไปขัดตอนผู้ใช้กดพับกลุ่มที่ตัวเองอยู่)
  useEffect(() => {
    const g = GROUPS.find(gr => gr.items.some(it => isActivePath(location.pathname, it.to)))
    if (g) setCollapsed(c => (c[g.title] ? { ...c, [g.title]: false } : c))
  }, [location.pathname])

  const user = getAuthUser()
  const canManageRules = user?.role === 'ADMIN' || user?.role === 'REVIEWER'
  const isAdmin = user?.role === 'ADMIN'

  const groups: Group[] = [
    ...GROUPS,
    {
      title: 'ระบบ',
      items: [
        ...FOOTER_ITEMS,
        ...(canManageRules ? [{ to: '/settings', icon: SlidersHorizontal, label: 'ตั้งค่ากฎการตรวจสอบ' }] : []),
        ...(isAdmin ? [{ to: '/system-settings', icon: Settings, label: 'ตั้งค่าระบบ' }] : []),
      ],
    },
  ]

  return (
    <aside className="w-60 min-h-screen bg-blue-900 text-white flex flex-col shadow-xl">
      {/* Logo / Header */}
      <div className="px-5 py-5 border-b border-blue-800">
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
      <nav className="flex-1 px-3 py-3 overflow-y-auto">
        {groups.map((group, gi) => {
          const hasActive = group.items.some(it => isActivePath(location.pathname, it.to))
          const open = !collapsed[group.title]
          return (
            <div key={group.title} className={clsx(gi > 0 && 'mt-2 pt-2 border-t border-blue-800/60')}>
              <button
                type="button"
                onClick={() => setCollapsed(c => ({ ...c, [group.title]: !c[group.title] }))}
                aria-expanded={open}
                className="w-full flex items-start gap-1.5 px-3 py-1.5 rounded-lg text-left hover:bg-blue-800/50 transition-colors"
              >
                <ChevronDown className={clsx('w-3.5 h-3.5 mt-0.5 text-blue-300 transition-transform shrink-0',
                  !open && '-rotate-90')} />
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] font-semibold text-blue-300 uppercase tracking-wide">
                    {group.title}
                  </span>
                  {group.note && (
                    <span className="block text-[12px] text-blue-400/80 font-mono leading-tight truncate">{group.note}</span>
                  )}
                </span>
                {!open && (
                  <span className={clsx('text-[12px] rounded-full px-1.5 shrink-0',
                    hasActive ? 'bg-white text-blue-900 font-semibold' : 'bg-blue-800/70 text-blue-400')}
                    title={hasActive ? 'กลุ่มนี้มีหน้าที่กำลังเปิดอยู่' : ''}>
                    {group.items.length}
                  </span>
                )}
              </button>
              {open && (
                <div className="space-y-0.5 mt-0.5">
                  {group.items.map(({ to, icon: Icon, label }) => (
                    <NavLink
                      key={to}
                      to={to}
                      end={to === '/'}
                      className={({ isActive }) =>
                        clsx(
                          'flex items-center gap-2.5 px-3 py-2 rounded-lg text-[15px] font-medium transition-all',
                          isActive
                            ? 'bg-white text-blue-900 shadow'
                            : 'text-blue-200 hover:bg-blue-800 hover:text-white'
                        )
                      }
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="leading-tight">{label}</span>
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-blue-800">
        <p className="text-xs text-blue-400">v1.0.0 &copy; 2568</p>
      </div>
    </aside>
  )
}
