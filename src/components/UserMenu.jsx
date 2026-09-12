import { useEffect, useRef, useState } from 'react'
import { CircleUser, LogOut } from 'lucide-react'
import AsyncButton from './AsyncButton'

/**
 * เมนูผู้ใช้มุมขวาบน — เก็บอีเมลกับปุ่มออกจากระบบไว้ข้างใน
 *
 * เดิมทั้งสองอย่างกางอยู่บนแถบหัวตลอดเวลา กินพื้นที่ทั้งที่แทบไม่ได้กด
 * และปุ่มออกจากระบบที่โผล่ค้างไว้ก็กดพลาดง่ายด้วย
 */
export default function UserMenu({ email, onSignOut }) {
  const [open, setOpen] = useState(false)
  const boxRef = useRef(null)

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

  return (
    <div className="user-menu" ref={boxRef}>
      <button
        type="button"
        className="bar-icon-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="เมนูผู้ใช้"
        onClick={() => setOpen((v) => !v)}
      >
        <CircleUser size={20} strokeWidth={1.8} />
      </button>

      {open && (
        <div className="user-menu-pop" role="menu">
          <div className="user-menu-email">{email}</div>
          <AsyncButton
            className="user-menu-item"
            busyLabel="กำลังออก..."
            onClick={onSignOut}
          >
            <LogOut size={16} strokeWidth={1.8} aria-hidden="true" />
            ออกจากระบบ
          </AsyncButton>
        </div>
      )}
    </div>
  )
}
