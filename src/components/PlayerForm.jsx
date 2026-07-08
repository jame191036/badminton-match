import { useState } from 'react'
import { SKILL_LEVELS } from '../utils/pairing'

export default function PlayerForm({ onAdd }) {
  const [name, setName] = useState('')
  const [skill, setSkill] = useState(2)

  function handleSubmit(e) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    onAdd(trimmed, skill)
    setName('')
  }

  return (
    <form className="player-form" onSubmit={handleSubmit}>
      <input
        type="text"
        placeholder="ชื่อผู้เล่น"
        value={name}
        onChange={(e) => setName(e.target.value)}
        aria-label="ชื่อผู้เล่น"
      />
      <select value={skill} onChange={(e) => setSkill(Number(e.target.value))} aria-label="ระดับฝีมือ">
        {SKILL_LEVELS.map((s) => (
          <option key={s.value} value={s.value}>{s.label}</option>
        ))}
      </select>
      <button type="submit" className="btn-primary">+ เพิ่มผู้เล่น</button>
    </form>
  )
}
