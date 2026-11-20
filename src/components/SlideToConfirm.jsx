import { useRef, useState } from 'react'
import { Check, ChevronsRight } from 'lucide-react'

const PASS = 0.8 // ลากเกินเท่านี้ของรางถือว่าตั้งใจ
const FLING = 0.6 // px/ms — สะบัดเร็วกว่านี้ผ่านได้แม้ยังไม่ถึง 80% (ต้องเลยมาแล้ว 30%)
const INSET = 4 // ระยะขอบในของราง ตรงกับ padding ใน CSS

/**
 * สไลเดอร์ยืนยัน — ใช้กับคำสั่งที่ย้อนไม่ได้และกดบ่อย (เริ่มเกม / จบเกม)
 * แตะพลาดตอนเลื่อนจอจึงไม่มีผลอะไร ต่างจากปุ่มแตะทีเดียว
 *
 * - ปุ่มตามนิ้ว 1:1: เขียน transform ที่ตัว element เอง ไม่ผ่าน CSS var ของแม่ (ไม่ recalc ทั้งการ์ด)
 * - ปล่อยมือ: ผ่าน = วิ่งไปสุดราง ขึ้น ✓ แล้วค่อยส่งคำสั่ง · ไม่ผ่าน = เด้งกลับ 200ms ease-out
 * - แป้นพิมพ์: Enter/Space บนปุ่มสั่งได้ทันที (คนใช้แป้นพิมพ์ไม่ได้กดพลาดแบบนิ้ว)
 *
 * onConfirm คืน false เมื่อไม่สำเร็จ (ดู run ใน useBadmintonData — หน้าแสดงข้อความผิดพลาดให้แล้ว)
 * สไลเดอร์จะเด้งกลับให้ลองใหม่ · สำเร็จแล้วการ์ดเปลี่ยนสถานะ สไลเดอร์ตัวนี้หายไปเอง
 */
export default function SlideToConfirm({ label, tone = 'go', icon, onConfirm }) {
  const track = useRef(null)
  const knob = useRef(null)
  const fill = useRef(null)
  const text = useRef(null)
  const drag = useRef(null)
  const [done, setDone] = useState(false)

  const maxX = () => track.current.clientWidth - knob.current.offsetWidth - INSET * 2

  function paint(x, max) {
    knob.current.style.transform = `translateX(${x}px)`
    fill.current.style.transform = `scaleX(${Math.min(1, (x + knob.current.offsetWidth + INSET * 2) / track.current.clientWidth)})`
    text.current.style.opacity = String(Math.max(0, 1 - x / (max * 0.55)))
  }

  function settle(x) {
    track.current.dataset.settling = ''
    paint(x, maxX())
  }

  async function commit() {
    setDone(true)
    navigator.vibrate?.(12)
    settle(maxX())
    // ให้เห็น ✓ ที่ปลายรางแวบหนึ่งก่อนการ์ดเปลี่ยนสถานะ
    await new Promise((r) => setTimeout(r, 180))
    const ok = await onConfirm()
    if (ok === false && track.current) {
      setDone(false)
      settle(0)
    }
  }

  function onPointerDown(e) {
    if (done || drag.current) return
    delete track.current.dataset.settling
    knob.current.setPointerCapture(e.pointerId)
    drag.current = { startX: e.clientX, x: 0, max: maxX(), lastX: e.clientX, lastT: performance.now(), v: 0 }
    track.current.dataset.dragging = ''
  }

  function onPointerMove(e) {
    const d = drag.current
    if (!d) return
    const t = performance.now()
    d.v = (e.clientX - d.lastX) / Math.max(1, t - d.lastT)
    d.lastX = e.clientX
    d.lastT = t
    d.x = Math.min(d.max, Math.max(0, e.clientX - d.startX))
    paint(d.x, d.max)
  }

  function onPointerUp() {
    const d = drag.current
    if (!d) return
    drag.current = null
    delete track.current.dataset.dragging
    if (d.x >= d.max * PASS || (d.v > FLING && d.x > d.max * 0.3)) commit()
    else settle(0)
  }

  return (
    <div
      ref={track}
      className={`slide-confirm is-${tone}`}
      data-done={done ? '' : undefined}
      aria-busy={done || undefined}
    >
      <span ref={fill} className="slide-confirm-fill" aria-hidden="true" />
      <span ref={text} className="slide-confirm-label" aria-hidden="true">
        {label} <ChevronsRight size={16} />
      </span>
      <button
        ref={knob}
        type="button"
        className="slide-confirm-knob"
        aria-label={`${label} (ลากไปขวา หรือกด Enter)`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !done) {
            e.preventDefault()
            commit()
          }
        }}
      >
        {done ? <Check size={20} strokeWidth={3} aria-hidden="true" /> : icon}
      </button>
    </div>
  )
}
