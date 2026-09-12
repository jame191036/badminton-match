import { skillLabel } from '../utils/pairing'

const SKILL_CLASS = { 1: 'skill-1', 2: 'skill-2', 3: 'skill-3' }

export default function PlayerQueue({ players, onToggleRest, onRemove, onSetAttendance }) {
  const waiting = players
    .filter((p) => p.status === 'waiting')
    .sort((a, b) => a.gamesPlayed - b.gamesPlayed || a.queuedAt - b.queuedAt)
  const resting = players.filter((p) => p.status === 'resting')
  const absent = players.filter((p) => p.status === 'absent')

  if (players.length === 0) {
    return <p className="empty-state">ยังไม่มีผู้เล่นในก๊วน — เพิ่มชื่อด้านบนเพื่อเริ่มจัดคิว</p>
  }

  return (
    <div className="queue-wrap">
      <div className="queue-col">
        <h3>คิวรอลงคอร์ต ({waiting.length})</h3>
        <ol className="queue-list">
          {waiting.map((p, i) => (
            <li key={p.id} className="queue-item">
              <span className="queue-pos mono">{i + 1}</span>
              <span className="queue-name">{p.name}</span>
              <span className={`skill-badge ${SKILL_CLASS[p.skill]}`}>{skillLabel(p.skill)}</span>
              <span className="games-count mono" title="จำนวนเกมที่เล่นแล้ว">{p.gamesPlayed} เกม</span>
              <button className="btn-ghost" onClick={() => onToggleRest(p.id)}>พัก</button>
              <button
                className="btn-ghost"
                title="ลงชื่อไว้แต่วันนี้ไม่มา — จะไม่ถูกนับเป็นคนหารค่าใช้จ่าย"
                onClick={() => onSetAttendance(p.id, false)}
              >
                ไม่มา
              </button>
              <button className="btn-ghost btn-danger" onClick={() => onRemove(p.id)}>ลบ</button>
            </li>
          ))}
          {waiting.length === 0 && <p className="empty-state small">ไม่มีใครรอคิวอยู่ตอนนี้</p>}
        </ol>
      </div>

      {resting.length > 0 && (
        <div className="queue-col">
          <h3>พักอยู่ ({resting.length})</h3>
          <ol className="queue-list">
            {resting.map((p) => (
              <li key={p.id} className="queue-item resting">
                <span className="queue-name">{p.name}</span>
                <span className={`skill-badge ${SKILL_CLASS[p.skill]}`}>{skillLabel(p.skill)}</span>
                <button className="btn-ghost" onClick={() => onToggleRest(p.id)}>กลับเข้าคิว</button>
                <button className="btn-ghost btn-danger" onClick={() => onRemove(p.id)}>ลบ</button>
              </li>
            ))}
          </ol>
        </div>
      )}

      {absent.length > 0 && (
        <div className="queue-col">
          <h3>ไม่มา ({absent.length})</h3>
          <p className="empty-state small">ไม่ถูกนับเป็นคนหารค่าใช้จ่าย</p>
          <ol className="queue-list">
            {absent.map((p) => (
              <li key={p.id} className="queue-item absent">
                <span className="queue-name">{p.name}</span>
                <span className={`skill-badge ${SKILL_CLASS[p.skill]}`}>{skillLabel(p.skill)}</span>
                <button className="btn-ghost" onClick={() => onSetAttendance(p.id, true)}>
                  มาแล้ว
                </button>
                <button className="btn-ghost btn-danger" onClick={() => onRemove(p.id)}>ลบ</button>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}
