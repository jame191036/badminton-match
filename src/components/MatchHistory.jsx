export default function MatchHistory({ history }) {
  if (history.length === 0) {
    return <p className="empty-state small">ยังไม่มีประวัติการแข่งขัน</p>
  }

  return (
    <ul className="history-list">
      {history.map((h) => (
        <li key={h.id} className="history-item">
          <span className="history-time mono">{h.time}</span>
          <span className="history-court">{h.courtName}</span>
          <span className="history-teams">
            {h.teamA.join(' + ')} <span className="vs-inline">vs</span> {h.teamB.join(' + ')}
          </span>
        </li>
      ))}
    </ul>
  )
}
