import { History } from 'lucide-react'
import FixHistoryPanel from '../components/FixHistoryPanel'

// ประวัติการแก้ไฟล์ส่งเบิกของทุกเมนูในที่เดียว (CPAP/PSG มีประวัติแยกในหน้าของตัวเอง)
export default function FixHistoryPage() {
  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <History className="w-5 h-5 text-blue-600" /> ประวัติการแก้ไฟล์ทุกเมนู
        </h2>
        <p className="text-sm text-gray-500 mt-0.5">
          ไฟล์ที่แก้จากทุกเมนูถูกเก็บไว้ที่นี่ — โหลดซ้ำได้ กรองตามเมนู / ปีงบ หรือค้นหาเลขงวด / AN ได้
          (ประวัติ CPAP / PSG อยู่ในหน้า CPAP ซึ่งแก้ซ้ำได้ด้วย)
        </p>
      </div>
      <FixHistoryPanel />
    </div>
  )
}
