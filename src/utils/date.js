/**
 * วันนี้ในรูปแบบ YYYY-MM-DD ตามเวลาเครื่องผู้ใช้
 *
 * ไม่ใช้ toISOString() ตรงๆ เพราะมันแปลงเป็น UTC ก่อน
 * ไทยเป็น UTC+7 ตอนเช้ามืดจะได้ "เมื่อวาน" กลับมา — ต้องหักออฟเซ็ตออกก่อน
 *
 * ใช้เทียบกับ sessions.play_date ซึ่งเป็น date ไม่มีเวลา จึงเทียบเป็นสตริงได้เลย
 */
export function todayISO() {
  const now = new Date()
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

/** บวก/ลบวันจากสตริง YYYY-MM-DD คืนเป็นสตริงรูปแบบเดิม */
export function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`
}

/**
 * ---- ตัวช่วยสำหรับปฏิทิน ----
 *
 * locale 'th-TH' ของ JS ใช้ปฏิทินพุทธอยู่แล้ว toLocaleDateString จึงคืน พ.ศ.
 * ให้เองโดยไม่ต้องบวก 543 เอง — ต่างจาก <input type="date"> ที่บังคับเป็น ค.ศ.
 * ซึ่งเป็นเหตุผลที่เราทำปฏิทินเอง
 */

/** '2026-09' -> 'กันยายน 2569' */
export function thaiMonthYear(yearMonth) {
  return new Date(`${yearMonth}-01T00:00:00`).toLocaleDateString('th-TH', {
    month: 'long',
    year: 'numeric',
  })
}

/** 'YYYY-MM-DD' -> วันที่ภาษาไทย ตาม options ของ toLocaleDateString (ว่าง = '') */
export function thaiDate(iso, options) {
  if (!iso) return ''
  return new Date(`${iso}T00:00:00`).toLocaleDateString('th-TH', options)
}

/** '2026-09-12' -> 'เสาร์ 12 ก.ย. 2569' */
export const thaiFullDate = (iso) =>
  thaiDate(iso, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })

/** เวลาจาก DB ('19:00:00') -> '19:00' */
export const clock = (t) => (t ? String(t).slice(0, 5) : '')

/** เลื่อนเดือน: ('2026-09', 1) -> '2026-10' */
export function addMonths(yearMonth, months) {
  const [y, m] = yearMonth.split('-').map(Number)
  const d = new Date(y, m - 1 + months, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/**
 * ตารางวันของเดือนนั้น เป็นแถวละ 7 ช่อง เริ่มวันอาทิตย์ตามปฏิทินไทย
 * ช่องที่ไม่ใช่ของเดือนนี้เป็น null (ไม่ยืมวันจากเดือนข้างเคียงมาแสดง
 * เพราะทำให้กดผิดเดือนได้ง่าย)
 */
export function monthMatrix(yearMonth) {
  const [y, m] = yearMonth.split('-').map(Number)
  const firstWeekday = new Date(y, m - 1, 1).getDay()
  const daysInMonth = new Date(y, m, 0).getDate()

  const cells = Array(firstWeekday).fill(null)
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${yearMonth}-${String(d).padStart(2, '0')}`)
  }
  while (cells.length % 7 !== 0) cells.push(null)

  const weeks = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))
  return weeks
}

/** บวกชั่วโมงให้เวลารูปแบบ HH:mm (วนรอบข้ามเที่ยงคืนได้) */
export function addHours(hhmm, hours) {
  if (!hhmm) return ''
  const [h, m] = hhmm.split(':').map(Number)
  const total = (((h * 60 + m + hours * 60) % 1440) + 1440) % 1440
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** ผลต่างเป็นชั่วโมงระหว่างสองเวลา HH:mm (ถ้าจบเลยเที่ยงคืนจะคิดข้ามวันให้) */
export function hoursBetween(start, end) {
  if (!start || !end) return null
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  const diff = (((eh * 60 + em - (sh * 60 + sm)) % 1440) + 1440) % 1440
  return diff / 60
}

/** วินาที -> 'mm:ss' ใช้ทั้งนาฬิกาบนคอร์ตและเวลาต่อเกมในประวัติ (null = ไม่แสดง) */
export function mmss(seconds) {
  if (seconds == null) return null
  const total = Math.max(0, Math.floor(seconds))
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** นาที -> '45 นาที' / '2 ชม.' / '2 ชม. 30 นาที' (0 หรือว่าง = '—') */
export function formatMinutes(min) {
  if (!min) return '—'
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return `${m} นาที`
  return m === 0 ? `${h} ชม.` : `${h} ชม. ${m} นาที`
}
