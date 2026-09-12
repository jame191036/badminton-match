import { createContext, useContext } from 'react'

// แยกไฟล์จาก ConfirmProvider.jsx เพราะ react-refresh ต้องการให้ไฟล์ .jsx
// export เฉพาะ component เท่านั้น ถึงจะ hot reload ได้ถูกต้อง
export const ConfirmContext = createContext(null)

/**
 * ใช้แทน window.confirm() — คืน Promise<boolean>
 *
 *   const confirm = useConfirm()
 *   if (await confirm({ title: 'ลบ?', danger: true })) remove(id)
 *
 * ตัวเลือก: title, message, confirmLabel, cancelLabel, danger, requireText
 * (requireText = ต้องพิมพ์ข้อความนี้ให้ตรงก่อนปุ่มยืนยันถึงจะกดได้)
 */
export function useConfirm() {
  const confirm = useContext(ConfirmContext)
  if (!confirm) throw new Error('useConfirm ต้องอยู่ภายใต้ <ConfirmProvider>')
  return confirm
}
