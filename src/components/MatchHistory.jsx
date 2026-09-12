// นาที:วินาที แบบเดียวกับนาฬิกาที่เดินอยู่บนคอร์ต (ดู CourtBoard)
// เกมแบดส่วนใหญ่ 10-25 นาที การบอกเป็นวินาทีด้วยจึงยังอ่านง่าย
function formatDuration(seconds) {
  if (seconds == null) return null
  const total = Math.round(seconds)
  const mm = Math.floor(total / 60)
  const ss = String(total % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

export default function MatchHistory({ history }) {
  if (history.length === 0) {
    return <p className="empty-state small">ยังไม่มีประวัติการแข่งขัน</p>
  }

  const withDuration = history.filter((h) => h.durationSeconds != null)
  const totalSeconds = withDuration.reduce((sum, h) => sum + h.durationSeconds, 0)
  const avgSeconds = withDuration.length > 0 ? totalSeconds / withDuration.length : null

  return (
    <>
      {avgSeconds != null && (
        <p className="history-summary mono">
          {history.length} เกม · เฉลี่ยเกมละ {formatDuration(avgSeconds)} นาที · รวม{' '}
          {Math.round(totalSeconds / 60)} นาที
        </p>
      )}

      <ul className="history-list">
        {history.map((h) => (
          <li key={h.id} className="history-item">
            <span className="history-time mono">
              {h.startTime && `${h.startTime}–`}
              {h.time}
            </span>
            <span className="history-court">{h.courtName}</span>
            <span className="history-teams">
              {h.teamA.join(' + ')} <span className="vs-inline">vs</span> {h.teamB.join(' + ')}
            </span>
            {h.durationSeconds != null && (
              <span className="history-duration mono" title="เวลาที่ใช้เล่นเกมนี้">
                {formatDuration(h.durationSeconds)}
              </span>
            )}
          </li>
        ))}
      </ul>
    </>
  )
}
