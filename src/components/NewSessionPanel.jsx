import { useState } from 'react'
import { skillLabel } from '../utils/pairing'

function formatLastPlayed(iso) {
  if (!iso) return 'ยังไม่เคยลง'
  return new Date(iso).toLocaleDateString('th-TH', { day: '2-digit', month: 'short' })
}

export default function NewSessionPanel({ members, onOpen }) {
  const [name, setName] = useState('')
  const [selected, setSelected] = useState(() => new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function toggle(id) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleOpen() {
    setError('')
    setBusy(true)
    try {
      await onOpen(name.trim() || null, [...selected])
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="new-session">
      <h2>เปิดก๊วนใหม่</h2>
      <p className="new-session-lead">
        ก๊วนก่อนหน้าถูกปิดและเก็บเป็นประวัติแล้ว — เลือกคนที่มาวันนี้เพื่อเริ่มรอบใหม่
        จำนวนเกมและเวลาเล่นจะเริ่มนับใหม่ทั้งหมด
      </p>

      <label className="billing-field new-session-name">
        <span>ชื่อก๊วน (เว้นว่างได้ ระบบจะใส่วันที่ให้)</span>
        <input
          type="text"
          placeholder="เช่น ก๊วนพุธเย็น"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      {members.length === 0 ? (
        <p className="empty-state small">
          ยังไม่มีรายชื่อสมาชิก — เปิดก๊วนเปล่าไปก่อน แล้วเพิ่มผู้เล่นได้ตามปกติ
          ครั้งหน้าชื่อจะขึ้นมาให้เลือกเอง
        </p>
      ) : (
        <>
          <div className="new-session-head">
            <h3>ใครมาบ้าง ({selected.size}/{members.length})</h3>
            <div className="court-controls">
              <button className="btn-ghost" onClick={() => setSelected(new Set(members.map((m) => m.id)))}>
                เลือกทั้งหมด
              </button>
              <button className="btn-ghost" onClick={() => setSelected(new Set())}>
                ล้าง
              </button>
            </div>
          </div>

          <ul className="member-list">
            {members.map((m) => (
              <li key={m.id} className={`member-item ${selected.has(m.id) ? 'selected' : ''}`}>
                <label className="billing-checkbox">
                  <input
                    type="checkbox"
                    checked={selected.has(m.id)}
                    onChange={() => toggle(m.id)}
                  />
                  <span className="member-name">{m.name}</span>
                </label>
                <span className="stats-skill mono">{skillLabel(m.skill)}</span>
                <span className="member-meta mono">
                  {m.sessionsPlayed} ครั้ง · {m.totalGames} เกม
                </span>
                <span className="member-last mono">{formatLastPlayed(m.lastPlayedAt)}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {error && <p className="session-bar-error">{error}</p>}

      <button className="btn-primary new-session-go" onClick={handleOpen} disabled={busy}>
        {busy ? 'กำลังเปิด...' : `เปิดก๊วน${selected.size > 0 ? ` พร้อม ${selected.size} คน` : 'เปล่า'}`}
      </button>
    </div>
  )
}
