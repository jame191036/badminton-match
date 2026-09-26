import { skillLabel } from '../utils/pairing'
import { formatMinutes } from '../utils/date'
import { byRanking, scoredGames } from '../utils/ranking'

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

  // มีเกมที่จดแต้ม = เรียงตามอันดับแพ้/ชนะ ไม่งั้นเล่นเยอะสุดขึ้นก่อน
  const hasScores = present.some((p) => scoredGames(p) > 0)
  const ranked = [...present].sort(
    hasScores
      ? byRanking
      : (a, b) => b.gamesPlayed - a.gamesPlayed || b.minutesPlayed - a.minutesPlayed,
  )
  const games = present.map((p) => p.gamesPlayed)
  const maxGames = Math.max(...games)
  const minGames = Math.min(...games)

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

      {/* หัวตาราง: ใช้คลาสเดียวกับแถวข้อมูล ความกว้างคอลัมน์จะได้ตรงกันเป๊ะ
          โดยไม่ต้องนิยามความกว้างซ้ำสองที่ */}
      <div className="stats-item stats-head" aria-hidden="true">
        <span className="stats-pos">#</span>
        <span className="stats-name">ชื่อ</span>
        <span className="stats-skill">ระดับมือ</span>
        <span className="stats-status">สถานะ</span>
        <span className="stats-games">เล่นแล้ว</span>
        {hasScores && <span className="stats-record">ชนะ–แพ้</span>}
        <span className="stats-minutes">เวลา</span>
      </div>

      <ul className="stats-list">
        {ranked.map((p, i) => (
          <li key={p.id} className="stats-item">
            <span className="stats-pos mono">{i + 1}</span>
            <span className="stats-name">{p.name}</span>
            <span className="stats-skill mono">{skillLabel(p.skill)}</span>
            <span className={`stats-status status-${p.status}`}>
              {STATUS_LABEL[p.status] ?? p.status}
            </span>
            <span className="stats-games mono">{p.gamesPlayed} เกม</span>
            {hasScores && (
              <span className="stats-record mono" title={`แต้มได้-เสีย ${p.pointDiff > 0 ? '+' : ''}${p.pointDiff}`}>
                {p.wins}–{p.losses}
              </span>
            )}
            <span className="stats-minutes mono">{formatMinutes(p.minutesPlayed)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
