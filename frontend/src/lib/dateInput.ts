/**
 * จัดรูปวันที่ขณะพิมพ์เป็น YYYY-MM-DD — พิมพ์แค่ตัวเลข ระบบใส่ "-" คั่นให้เอง
 *   "20050210" -> "2005-02-10"   "2005" -> "2005"   "20050" -> "2005-0"
 * ใส่ "-" เฉพาะเมื่อมีตัวเลขตามหลัง จึงลบย้อนหลังได้ตามปกติ (ไม่ติดขีด)
 * วางแบบ วัน/เดือน/ปี (เช่น 10/2/2005) จะสลับเป็น 2005-02-10 ให้
 */
export function formatDateInput(raw: string): string {
  const dmy = raw.trim().match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/)
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`
  const d = raw.replace(/\D/g, '').slice(0, 8)
  if (d.length <= 4) return d
  if (d.length <= 6) return `${d.slice(0, 4)}-${d.slice(4)}`
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`
}

/** props ที่ใช้ร่วมกันของช่องกรอกวันที่ (แป้นตัวเลขบนมือถือ + ยาวไม่เกิน 10 ตัว) */
export const DATE_INPUT_PROPS = {
  placeholder: 'YYYY-MM-DD',
  inputMode: 'numeric' as const,
  maxLength: 10,
}
