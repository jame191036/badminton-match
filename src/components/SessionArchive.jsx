function formatBaht(n) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('th-TH', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
  })
}

function formatMinutes(min) {
  if (!min) return '—'
  if (min < 60) return `${min} นาที`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h} ชม.` : `${h} ชม. ${m} นาที`
}

export default function SessionArchive({ archive }) {
  if (archive.length === 0) {
    return <p className="empty-state small">ยังไม่มีก๊วนที่ปิดไปแล้ว</p>
  }

  return (
    <ul className="archive-list">
      {archive.map((s) => (
        <li key={s.id} className="archive-item">
          <div className="archive-head">
            <span className="archive-name">{s.name}</span>
            <span className="archive-date mono">{formatDate(s.closedAt)}</span>
          </div>
          <div className="archive-meta">
            <span>{s.playerCount} คน</span>
            <span>{s.gameCount} เกม</span>
            <span>{formatMinutes(s.playMinutes)}</span>
            <span>{s.totalHours} ชม. สนาม</span>
          </div>
          <div className="archive-money">
            <span className="mono">รวม {formatBaht(s.totalFee)} บาท</span>
            <span className="mono archive-per-person">
              คนละ {formatBaht(s.perPerson)} บาท ({s.payerCount} คน)
            </span>
          </div>
        </li>
      ))}
    </ul>
  )
}
