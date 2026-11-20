import { formatBaht, isPayer, splitShares } from './billing.js'
import { formatMinutes, clock, thaiFullDate } from './date.js'

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
  const splitMode = closed ? day.splitMode ?? 'equal' : billing.splitMode ?? 'equal'
  const total = closed ? day.finals.totalFee : billing.total
  // หารตามเกม: ยอดรายคนคิดจากยอดรวม (ที่ล็อกไว้ถ้าจบวันแล้ว) สูตรเดียวกับแท็บหารเงิน
  // หารเท่ากันของวันที่จบแล้ว: ใช้ final_per_person ตรง ๆ ให้ตรงกับที่ล็อกไว้ทุกสตางค์
  const split = closed ? splitShares({ players, total, splitMode }) : billing
  const perPerson = closed && splitMode === 'equal' ? day.finals.perPerson : split.perPerson
  const payerCount = closed && splitMode === 'equal' ? day.finals.payerCount : split.payerCount
  const byGames = splitMode === 'games'

  const timeRange = [clock(day.startTime), clock(day.endTime)].filter(Boolean).join('–')
  const place = [day.venueName, day.shuttleBrandName].filter(Boolean).join(' · ')

  // คนเล่นเยอะสุดขึ้นก่อน — ลำดับเดียวกับแท็บสถิติ
  const rows = [...present]
    .sort((a, b) => b.gamesPlayed - a.gamesPlayed)
    .map((p, i) => ({
      pos: i + 1,
      name: p.name,
      games: p.gamesPlayed,
      minutes: p.minutesPlayed > 0 ? formatMinutes(p.minutesPlayed) : '—',
      // ใช้เฉพาะตอนหารตามเกม (หารเท่ากันทุกคนจ่ายเท่าช่อง "คนละ" อยู่แล้ว)
      amount: isPayer(p) ? formatBaht(split.shares.get(p.id) ?? 0) : 'ไม่ร่วมจ่าย',
    }))

  return {
    clubName: clubName || 'ก๊วนแบดมินตัน',
    dateLabel: thaiFullDate(day.playDate),
    place: place || 'ไม่ระบุสนาม',
    timeLabel: timeRange || 'ไม่ระบุเวลา',
    closed,
    splitMode,
    tiles: [
      { label: 'เกมที่เล่น', value: String(summary?.finishedGames ?? 0) },
      { label: 'ผู้เล่น', value: `${present.length} คน` },
      { label: 'ยอดรวม', value: `${formatBaht(total)} บาท` },
      byGames
        ? { label: 'เกมละ ต่อคน', value: `${formatBaht(split.perGame)} บาท` }
        : { label: 'คนละ', value: `${formatBaht(perPerson)} บาท` },
    ],
    rows,
    // ท้ายรายงาน: เรื่องที่ตัวเลขด้านบนไม่ได้บอก แต่คนอ่านมักสงสัย
    notes: [
      byGames && 'หารตามจำนวนเกมที่แต่ละคนเล่น ยิ่งเล่นมากยิ่งจ่ายมาก',
      byGames && split.payerGames === 0 && 'ยังไม่มีเกมที่จบ จึงยังหารตามเกมไม่ได้',
      payerCount !== present.length && `หารกัน ${payerCount} คน จากผู้เล่น ${present.length} คน`,
      absent.length > 0 && `มีอีก ${absent.length} คนที่ลงชื่อไว้แต่ไม่มา (ไม่ถูกนับ)`,
      summary?.totalPlayMinutes > 0 && `เวลาเล่นรวมทุกคอร์ต ${formatMinutes(summary.totalPlayMinutes)}`,
      !closed && 'วันนี้ยังไม่จบ ยอดอาจเปลี่ยนได้',
    ].filter(Boolean),
  }
}

/**
 * หัวคอลัมน์ของตารางในรายงาน — ใช้ร่วมกันทั้ง print และรูป
 * หารตามเกมเพิ่มคอลัมน์ยอดรายคน เพราะแต่ละคนจ่ายไม่เท่ากัน
 */
export function reportColumns(report) {
  return [
    { key: 'pos', label: '#', width: 34, align: 'right' },
    { key: 'name', label: 'ชื่อ', width: 0, align: 'left' }, // 0 = ยืดเต็มที่เหลือ
    { key: 'games', label: 'เกม', width: 56, align: 'right' },
    { key: 'minutes', label: 'เวลา', width: 88, align: 'right' },
    ...(report?.splitMode === 'games' ? [{ key: 'amount', label: 'ยอด (บาท)', width: 120, align: 'right' }] : []),
  ]
}

/** ข้อความสั้นสำหรับแชร์คู่กับรูป (LINE จะโชว์เป็นแคปชัน) */
export function reportShareText(report) {
  const money = report.tiles[3]
  return [
    `สรุป${report.clubName} · ${report.dateLabel}`,
    `${report.tiles[0].value} เกม · ผู้เล่น ${report.tiles[1].value}`,
    `ยอดรวม ${report.tiles[2].value} · ${money.label} ${money.value}`,
  ].join('\n')
}

/** ชื่อไฟล์ที่เดาได้ เรียงตามวันได้เองเวลามีหลายไฟล์ */
export function reportFileName(report, ext) {
  const safe = report.clubName.replace(/[\\/:*?"<>|\s]+/g, '-')
  return `สรุป-${safe}-${report.dateLabel.replace(/\s+/g, '')}.${ext}`
}
