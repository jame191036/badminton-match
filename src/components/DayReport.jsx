import { reportColumns } from '../utils/report'

/**
 * รายงานสรุปวันเล่นในรูปแบบ DOM — มีไว้สำหรับสั่ง print เป็น PDF
 *
 * ซ่อนบนจอเสมอ (.print-only) และโผล่เฉพาะตอน print ส่วนที่เหลือของหน้า
 * ถูกซ่อนด้วย @media print ใน app.css จึงได้กระดาษที่มีแต่รายงาน
 *
 * ทำไมไม่ print หน้าจอจริงไปเลย: หน้าวันเล่นเป็นแท็บ เนื้อหาที่ไม่ได้เปิดอยู่
 * ไม่มีใน DOM เลย กระดาษจะได้แค่แท็บที่กำลังดู ไม่ใช่สรุปทั้งวัน
 *
 * ใช้ข้อมูลชุดเดียวกับรูป PNG (buildDayReport) ตัวเลขจึงตรงกันแน่นอน
 */
export default function DayReport({ report }) {
  const cols = reportColumns(report.hasScores)

  return (
    <div className="print-only day-report">
      <header className="report-head">
        <h1>{report.clubName}</h1>
        <p className="report-when">
          {report.dateLabel} · {report.timeLabel}
        </p>
        <p className="report-place">{report.place}</p>
      </header>

      <div className="report-tiles">
        {report.tiles.map((t) => (
          <div key={t.label} className="report-tile">
            <span className="report-tile-value">{t.value}</span>
            <span className="report-tile-label">{t.label}</span>
          </div>
        ))}
      </div>

      <table className="report-table">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.key} className={c.align === 'right' ? 'is-num' : ''}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {report.rows.map((r) => (
            <tr key={r.pos}>
              {cols.map((c) => (
                <td key={c.key} className={c.align === 'right' ? 'is-num' : ''}>
                  {r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {report.notes.length > 0 && (
        <ul className="report-notes">
          {report.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
