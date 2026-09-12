import { useState } from 'react'
import { UserPlus } from 'lucide-react'
import { SKILL_LEVELS } from '../utils/pairing'
import AsyncButton from './AsyncButton'

/**
 * เพิ่มผู้เล่นหน้างานด้วยการพิมพ์ชื่อ
 *
 * ติ๊ก "แขกขาจร" = ไม่บันทึกเข้ารายชื่อสมาชิก ใช้กับคนที่เพื่อนพามาเล่นวันเดียว
 * ถ้าไม่มีตัวเลือกนี้ รายชื่อ master จะบวมขึ้นเรื่อย ๆ ด้วยคนที่ไม่มาอีกเลย
 */
export default function PlayerForm({ onAdd }) {
  const [name, setName] = useState('')
  const [skill, setSkill] = useState(2)
  const [guest, setGuest] = useState(false)

  async function handleSubmit() {
    const trimmed = name.trim()
    if (!trimmed) return
    await onAdd(trimmed, skill, !guest)
    setName('')
  }

  return (
    <form
      className="player-form"
      onSubmit={(e) => {
        e.preventDefault()
        handleSubmit()
      }}
    >
      <input
        type="text"
        placeholder="ชื่อผู้เล่น"
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-label="ชื่อผู้เล่น"
      />
      <select
        value={skill}
        onChange={(e) => setSkill(Number(e.target.value))}
        aria-label="ระดับฝีมือ"
      >
        {SKILL_LEVELS.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
      {/* type=button ไม่ใช่ submit — ไม่งั้นคลิกเดียวจะยิงทั้ง onClick และ onSubmit */}
      <AsyncButton
        className="btn-primary"
        onClick={handleSubmit}
        busyLabel="กำลังเพิ่ม…"
        disabled={!name.trim()}
      >
        <UserPlus size={16} aria-hidden="true" />
        เพิ่มผู้เล่น
      </AsyncButton>

      <label className="guest-toggle" title="ไม่บันทึกชื่อนี้เข้ารายชื่อสมาชิก">
        <input type="checkbox" checked={guest} onChange={(e) => setGuest(e.target.checked)} />
        <span>แขกขาจร (ไม่เก็บเข้ารายชื่อ)</span>
      </label>
    </form>
  )
}
