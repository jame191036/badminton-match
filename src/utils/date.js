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
