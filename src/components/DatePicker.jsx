import { useEffect, useRef, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { addMonths, monthMatrix, thaiFullDate, thaiMonthYear, todayISO } from '../utils/date'

const WEEKDAYS = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส']

/**
 * ปฏิทินเลือกวัน แสดงเป็น พ.ศ. และเดือนไทย
 *
 * ไม่ใช้ <input type="date"> เพราะเบราว์เซอร์บังคับแสดงเป็น ค.ศ. เสมอ
 * สั่งให้เป็น พ.ศ. ไม่ได้ ทำให้วันเดียวกันในแอปเขียนต่างกัน 543 ปี
 * (ช่องกรอกขึ้น 12/09/2026 แต่รายการวันเล่นขึ้น 12 ก.ย. 69)
 *
 * รับ/คืนค่าเป็นสตริง YYYY-MM-DD เหมือนเดิม ฝั่ง DB จึงไม่ต้องเปลี่ยนอะไร
 */
export default function DatePicker({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const [today] = useState(todayISO)
  const [viewMonth, setViewMonth] = useState(() => (value || today).slice(0, 7))
  const boxRef = useRef(null)

  // เปิดปฏิทินทีไร ให้เด้งไปเดือนของวันที่เลือกอยู่เสมอ
  // ไม่ใช่ค้างอยู่เดือนที่เลื่อนดูไว้ครั้งก่อน
  function toggle() {
    if (!open) setViewMonth((value || today).slice(0, 7))
    setOpen((v) => !v)
  }

  useEffect(() => {
    if (!open) return

    function onPointerDown(e) {
      if (!boxRef.current?.contains(e.target)) setOpen(false)
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function pick(iso) {
    onChange(iso)
    setOpen(false)
  }

  return (
    <div className="date-picker" ref={boxRef}>
      <button
        type="button"
        className="date-picker-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
      >
        <CalendarDays size={17} strokeWidth={1.8} aria-hidden="true" />
        <span className={value ? '' : 'is-placeholder'}>
          {value ? thaiFullDate(value) : 'เลือกวันที่'}
        </span>
      </button>

      {open && (
        <div className="date-picker-pop" role="dialog" aria-label="เลือกวันที่">
          <div className="date-picker-head">
            <button
              type="button"
              className="btn-icon"
              aria-label="เดือนก่อนหน้า"
              onClick={() => setViewMonth((m) => addMonths(m, -1))}
            >
              <ChevronLeft size={18} strokeWidth={2} />
            </button>
            <span className="date-picker-month">{thaiMonthYear(viewMonth)}</span>
            <button
              type="button"
              className="btn-icon"
              aria-label="เดือนถัดไป"
              onClick={() => setViewMonth((m) => addMonths(m, 1))}
            >
              <ChevronRight size={18} strokeWidth={2} />
            </button>
          </div>

          <div className="date-picker-grid">
            {WEEKDAYS.map((w, i) => (
              <span key={w} className={`date-picker-weekday${i === 0 || i === 6 ? ' is-weekend' : ''}`}>
                {w}
              </span>
            ))}

            {monthMatrix(viewMonth).map((week, wi) =>
              week.map((iso, di) =>
                iso ? (
                  <button
                    key={iso}
                    type="button"
                    className={[
                      'date-picker-day',
                      iso === value ? 'is-selected' : '',
                      iso === today ? 'is-today' : '',
                      di === 0 || di === 6 ? 'is-weekend' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => pick(iso)}
                  >
                    {Number(iso.slice(8))}
                  </button>
                ) : (
                  <span key={`${wi}-${di}`} />
                ),
              ),
            )}
          </div>

          <button type="button" className="btn-ghost date-picker-today" onClick={() => pick(today)}>
            วันนี้
          </button>
        </div>
      )}
    </div>
  )
}
