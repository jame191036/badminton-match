import { formatBaht } from './billing.js'
import { formatMinutes, clock, thaiFullDate } from './date.js'
import { byRanking, scoredGames } from './ranking.js'

/**
 * ข้อมูลรายงานสรุปวันเล่น — ชั้นกลางที่ใช้ร่วมกันสองทาง
 *
 *   DayReport.jsx    -> เรนเดอร์เป็น DOM สำหรับสั่ง print เป็น PDF
 *   reportImage.js   -> วาดลง canvas เป็น PNG สำหรับส่ง LINE
 *
 * แยกออกมาเป็นไฟล์บริสุทธิ์เพราะสองทางนั้นต้องได้เลขชุดเดียวกันเป๊ะ
 * ถ้าแต่ละฝั่งคำนวณเอง วันใดวันหนึ่งจะเพี้ยนกันแล้วไม่มีใครรู้
 * (และแบบนี้ node รันตรวจได้ใน npm run check ต่างจากโค้ด canvas)
 */
export function buildDayReport({ day, players, summary, billing, clubName }) {
  const present = players.filter((p) => p.status !== 'absent')
  const absent = players.filter((p) => p.status === 'absent')

  // วันที่จบแล้วใช้ยอดที่ freeze ไว้ ไม่ใช่ยอดสด — กฎเดียวกับ v_club_days
  const closed = day.status === 'done'
  const total = closed ? day.finals.totalFee : billing.total
  const perPerson = closed ? day.finals.perPerson : billing.perPerson
  const payerCount = closed ? day.finals.payerCount : billing.payerCount

  const timeRange = [clock(day.startTime), clock(day.endTime)].filter(Boolean).join('–')
  const place = [day.venueName, day.shuttleBrandName].filter(Boolean).join(' · ')

  // มีเกมที่จดแต้มแล้วค่อยเรียงตามอันดับ ไม่งั้นเรียงตามคนเล่นเยอะสุด
  const hasScores = present.some((p) => scoredGames(p) > 0)
  const rows = [...present]
    .sort(hasScores ? byRanking : (a, b) => b.gamesPlayed - a.gamesPlayed)
    .map((p, i) => ({
      pos: i + 1,
      name: p.name,
      games: p.gamesPlayed,
      record: hasScores && scoredGames(p) > 0 ? `${p.wins}–${p.losses}` : '—',
      minutes: p.minutesPlayed > 0 ? formatMinutes(p.minutesPlayed) : '—',
      paid: closed ? Boolean(p.paidAt) : null,
    }))

  return {
    clubName: clubName || 'ก๊วนแบดมินตัน',
    dateLabel: thaiFullDate(day.playDate),
    place: place || 'ไม่ระบุสนาม',
    timeLabel: timeRange || 'ไม่ระบุเวลา',
    closed,
    hasScores,
    tiles: [
      { label: 'เกมที่เล่น', value: String(summary?.finishedGames ?? 0) },
      { label: 'ผู้เล่น', value: `${present.length} คน` },
      { label: 'ยอดรวม', value: `${formatBaht(total)} บาท` },
      { label: 'คนละ', value: `${formatBaht(perPerson)} บาท` },
    ],
    rows,
    // ท้ายรายงาน: เรื่องที่ตัวเลขด้านบนไม่ได้บอก แต่คนอ่านมักสงสัย
    notes: [
      payerCount !== present.length && `หารกัน ${payerCount} คน จากผู้เล่น ${present.length} คน`,
      absent.length > 0 && `มีอีก ${absent.length} คนที่ลงชื่อไว้แต่ไม่มา (ไม่ถูกนับ)`,
      summary?.totalPlayMinutes > 0 && `เวลาเล่นรวมทุกคอร์ต ${formatMinutes(summary.totalPlayMinutes)}`,
      !closed && 'วันนี้ยังไม่จบ ยอดอาจเปลี่ยนได้',
    ].filter(Boolean),
  }
}

/** หัวคอลัมน์ของตารางในรายงาน — ใช้ร่วมกันทั้ง print และรูป */
export function reportColumns(hasScores) {
  return [
    { key: 'pos', label: '#', width: 34, align: 'right' },
    { key: 'name', label: 'ชื่อ', width: 0, align: 'left' }, // 0 = ยืดเต็มที่เหลือ
    { key: 'games', label: 'เกม', width: 56, align: 'right' },
    ...(hasScores ? [{ key: 'record', label: 'ชนะ–แพ้', width: 80, align: 'right' }] : []),
    { key: 'minutes', label: 'เวลา', width: 88, align: 'right' },
  ]
}

/** ข้อความสั้นสำหรับแชร์คู่กับรูป (LINE จะโชว์เป็นแคปชัน) */
export function reportShareText(report) {
  return [
    `สรุป${report.clubName} · ${report.dateLabel}`,
    `${report.tiles[0].value} เกม · ผู้เล่น ${report.tiles[1].value}`,
    `ยอดรวม ${report.tiles[2].value} · คนละ ${report.tiles[3].value}`,
  ].join('\n')
}

/** ชื่อไฟล์ที่เดาได้ เรียงตามวันได้เองเวลามีหลายไฟล์ */
export function reportFileName(report, ext) {
  const safe = report.clubName.replace(/[\\/:*?"<>|\s]+/g, '-')
  return `สรุป-${safe}-${report.dateLabel.replace(/\s+/g, '')}.${ext}`
}
