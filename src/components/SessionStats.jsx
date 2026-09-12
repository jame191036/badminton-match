import { skillLabel } from '../utils/pairing'

function formatMinutes(min) {
  if (!min) return '—'
  if (min < 60) return `${min} นาที`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h} ชม.` : `${h} ชม. ${m} นาที`
}

const STATUS_LABEL = {
  waiting: 'รอคิว',
  playing: 'อยู่ในคอร์ต',
  resting: 'พัก',
  absent: 'ไม่มา',
}

export default function SessionStats({ players, summary }) {
  // คนที่ไม่มาไม่นับในสถิติ — ให้ตรงกับ summary.playerCount ที่มาจาก
  // v_session_summary ซึ่งตัด absent ออกแล้ว ไม่งั้นตัวเลขสองที่ในหน้าเดียวกันจะขัดกัน
  const present = players.filter((p) => p.status !== 'absent')
  const absentCount = players.length - present.length

  if (present.length === 0) {
    return <p className="empty-state small">ยังไม่มีผู้เล่นที่มา</p>
  }

  // เล่นเยอะสุดขึ้นก่อน คนที่ยังไม่ได้ลงเลยจะไปอยู่ท้ายสุด
  const ranked = [...present].sort(
    (a, b) => b.gamesPlayed - a.gamesPlayed || b.minutesPlayed - a.minutesPlayed
  )
  const maxGames = ranked[0]?.gamesPlayed ?? 0
  const minGames = ranked[ranked.length - 1]?.gamesPlayed ?? 0

  return (
    <div className="stats">
      {summary && (
        <div className="stats-summary">
          <div className="stat-tile">
            <span className="stat-value mono">{summary.finishedGames}</span>
            <span className="stat-label">เกมที่จบแล้ว</span>
          </div>
          <div className="stat-tile">
            <span className="stat-value mono">{summary.playerCount}</span>
            <span className="stat-label">ผู้เล่น</span>
          </div>
          <div className="stat-tile">
            <span className="stat-value mono">{summary.courtCount}</span>
            <span className="stat-label">คอร์ตที่จอง</span>
          </div>
          <div className="stat-tile">
            <span className="stat-value mono">{formatMinutes(summary.totalPlayMinutes)}</span>
            <span className="stat-label">เวลาเล่นรวมทุกคอร์ต</span>
          </div>
        </div>
      )}

      {absentCount > 0 && (
        <p className="stats-note">
          มีอีก {absentCount} คนที่ลงชื่อไว้แต่ไม่มา — ไม่ถูกนับทั้งในสถิติและในการหารค่าใช้จ่าย
        </p>
      )}

      {maxGames - minGames >= 2 && (
        <p className="stats-note">
          ตอนนี้คนเล่นเยอะสุดกับน้อยสุดต่างกัน {maxGames - minGames} เกม —
          ระบบจะเลือกคนที่เล่นน้อยกว่าลงก่อนอยู่แล้ว
        </p>
      )}

      <ul className="stats-list">
        {ranked.map((p) => (
          <li key={p.id} className="stats-item">
            <span className="stats-name">{p.name}</span>
            <span className="stats-skill mono">{skillLabel(p.skill)}</span>
            <span className={`stats-status status-${p.status}`}>
              {STATUS_LABEL[p.status] ?? p.status}
            </span>
            <span className="stats-games mono">{p.gamesPlayed} เกม</span>
            <span className="stats-minutes mono">{formatMinutes(p.minutesPlayed)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
