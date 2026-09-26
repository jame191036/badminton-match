import { useState } from 'react'
import { FileText, ImageDown } from 'lucide-react'
import AsyncButton from './AsyncButton'
import { renderReportImage } from '../utils/reportImage'
import { reportShareText } from '../utils/report'
import { shareFile } from '../utils/share'

const RESULT_TEXT = {
  shared: 'ส่งรูปแล้ว',
  downloaded: 'บันทึกรูปลงเครื่องแล้ว',
  cancelled: '',
}

/**
 * ปุ่มบันทึกรายงาน 2 แบบ
 *
 * PDF ใช้ window.print() ของเบราว์เซอร์ ไม่ใช่ library — ฟอนต์ไทยเป๊ะ
 * ข้อความยังเลือก/ค้นหาได้ และไม่บวม bundle เลย แลกกับต้องเลือก
 * "บันทึกเป็น PDF" ในหน้าต่าง print เอง ซึ่งทุกเบราว์เซอร์มีให้อยู่แล้ว
 *
 * รูปวาดลง canvas เอง (ดู reportImage.js) แล้วส่งเข้าเมนูแชร์ของเครื่อง
 * บนมือถือ = ส่งเข้า LINE ได้ทันที บนคอมพิวเตอร์ = ดาวน์โหลดไฟล์
 */
export default function ExportReport({ report }) {
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  return (
    <div className="export-report">
      <AsyncButton
        onClick={() => {
          // print เป็น synchronous และบล็อกหน้าไว้จนปิดหน้าต่าง
          // ต้องรอ paint รอบหนึ่งก่อน ไม่งั้นบางเบราว์เซอร์จับภาพก่อนรายงานขึ้นจอ
          setError('')
          return new Promise((resolve) =>
            requestAnimationFrame(() => {
              window.print()
              resolve()
            }),
          )
        }}
        busyLabel="กำลังเตรียม..."
      >
        <FileText size={16} aria-hidden="true" />
        บันทึก PDF
      </AsyncButton>

      <AsyncButton
        onClick={async () => {
          setError('')
          setNotice('')
          try {
            const { blob, fileName } = await renderReportImage(report)
            const result = await shareFile(blob, fileName, reportShareText(report))
            setNotice(RESULT_TEXT[result] ?? '')
          } catch (err) {
            console.error(err)
            setError(`สร้างรูปไม่สำเร็จ: ${err.message}`)
          }
        }}
        busyLabel="กำลังสร้างรูป..."
      >
        <ImageDown size={16} aria-hidden="true" />
        บันทึกรูป
      </AsyncButton>

      <span className="export-hint">
        {error ? (
          <span className="export-error">{error}</span>
        ) : (
          notice || 'PDF จะเปิดหน้าต่างพิมพ์ ให้เลือก “บันทึกเป็น PDF”'
        )}
      </span>
    </div>
  )
}
