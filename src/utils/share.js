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

/**
 * ส่งไฟล์ออกไป: มือถือเปิดเมนูแชร์ (ส่งเข้า LINE ได้เลย) คอมพิวเตอร์ดาวน์โหลด
 * คืน 'shared' | 'downloaded' | 'cancelled'
 *
 * เช็ค canShare({ files }) ก่อนเสมอ — เบราว์เซอร์หลายตัวมี navigator.share
 * แต่ส่งไฟล์ไม่ได้ ถ้าเรียกไปเลยจะโดนปฏิเสธแล้วผู้ใช้ไม่ได้อะไรกลับมา
 */
export async function shareFile(blob, fileName, text) {
  const file = new File([blob], fileName, { type: blob.type })

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text })
      return 'shared'
    } catch (err) {
      if (err.name === 'AbortError') return 'cancelled'
    }
  }

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  // ปล่อย url ทิ้งทันทีไม่ได้ Safari ยังอ่านอยู่ตอนเริ่มดาวน์โหลด
  setTimeout(() => URL.revokeObjectURL(url), 10000)
  return 'downloaded'
}
