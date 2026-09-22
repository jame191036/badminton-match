/**
 * ส่งข้อความออกไป: มือถือเปิดเมนูแชร์ของเครื่อง (เลือก LINE ได้เลย) คอมพิวเตอร์คัดลอกลงคลิปบอร์ด
 * คืน 'shared' | 'copied' | 'cancelled' ให้หน้าจอบอกผู้ใช้ถูก
 */
export async function shareText(text) {
  if (navigator.share) {
    try {
      await navigator.share({ text })
      return 'shared'
    } catch (err) {
      // กดปิดเมนูแชร์เอง ไม่ใช่ error
      if (err.name === 'AbortError') return 'cancelled'
    }
  }
  await navigator.clipboard.writeText(text)
  return 'copied'
}
