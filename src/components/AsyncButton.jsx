import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * ปุ่มที่รู้ตัวเองว่ากำลังรอ server อยู่ — กดแล้วขึ้นสปินเนอร์และกดซ้ำไม่ได้
 *
 * ทำเป็น component แทนที่จะถือ state ไว้ในหน้าแม่ เพราะหน้าหนึ่งมีปุ่มหลายตัว
 * (คอร์ตละ 3 ปุ่ม × หลายคอร์ต) ถ้าใช้ state ตัวเดียวจะขึ้นสปินเนอร์พร้อมกันหมด
 *
 * onClick ต้องคืน Promise ถึงจะรู้ว่าเสร็จเมื่อไหร่ — ถ้าเป็นฟังก์ชันธรรมดา
 * สปินเนอร์จะวาบแล้วหายทันที ซึ่งก็ถูกแล้วเพราะไม่ได้รออะไร
 */
export default function AsyncButton({
  onClick,
  children,
  busyLabel,
  className = 'btn-ghost',
  disabled = false,
  ...rest
}) {
  const [busy, setBusy] = useState(false)
  // ปุ่มมักหายไปหลังทำงานเสร็จ (เช่น "จบเกม" แล้วคอร์ตกลายเป็นว่าง)
  // ถ้าไม่กันไว้จะ setState หลัง unmount
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const handleClick = useCallback(
    async (e) => {
      if (busy) return
      setBusy(true)
      try {
        await onClick?.(e)
      } finally {
        if (mountedRef.current) setBusy(false)
      }
    },
    [busy, onClick],
  )

  return (
    <button
      {...rest}
      type={rest.type ?? 'button'}
      className={`${className}${busy ? ' is-busy' : ''}`}
      disabled={disabled || busy}
      aria-busy={busy}
      onClick={handleClick}
    >
      {busy && <span className="btn-spinner" aria-hidden="true" />}
      {busy && busyLabel ? busyLabel : children}
    </button>
  )
}
