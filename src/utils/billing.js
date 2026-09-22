// หารเงินและข้อความสรุปยอด — ใช้ทั้งแท็บหารเงิน แท็บเก็บเงิน และแท็บค้างจ่าย
// ต้องคิดตรงกับ v_billing_summary ใน SQL (ดู CLAUDE.md)
import { formatPromptPayId } from './promptpay.js'
import { thaiDate } from './date.js'

export function toNumber(v) {
  const n = parseFloat(v)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

export const formatBaht = (n) =>
  n.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })

/** คนที่ต้องจ่าย: มาจริง (ไม่ใช่ absent) และไม่ได้ถูกติ๊กออกจากผู้ร่วมจ่าย */
export const isPayer = (p) => p.status !== 'absent' && p.paying !== false

/**
 * ยอดสดของวันที่ยังไม่ปิด
 *   ค่าสนาม = Σ ชั่วโมงทุกคอร์ต × ราคา/ชม.   ค่าลูก = จำนวนลูก × ราคา/ลูก
 *   ต่อคน   = รวม ÷ จำนวนผู้ร่วมจ่าย (หารเท่ากัน ไม่ขึ้นกับจำนวนเกม)
 */
export function computeBilling({ players, courts, billing }) {
  const hourlyRate = toNumber(billing.hourlyRate)
  const shuttlePrice = toNumber(billing.shuttlePrice)
  const shuttleCount = toNumber(billing.shuttleCount)
  const totalHours = courts.reduce((s, c) => s + toNumber(c.hours), 0)
  const courtTotal = totalHours * hourlyRate
  const shuttleTotal = shuttleCount * shuttlePrice
  const total = courtTotal + shuttleTotal
  const payerCount = players.filter(isPayer).length
  return {
    hourlyRate,
    shuttleCount,
    totalHours,
    courtTotal,
    shuttleTotal,
    total,
    payerCount,
    perPerson: payerCount > 0 ? total / payerCount : 0,
  }
}

const promptPayLine = (club) =>
  club?.promptpayId
    ? `โอนพร้อมเพย์ ${formatPromptPayId(club.promptpayId)}${club.promptpayName ? ` (${club.promptpayName})` : ''}`
    : null

/**
 * ข้อความสรุปยอดของวันหนึ่ง ไว้วางในกลุ่ม LINE
 * live = วันที่ยังไม่ปิด ยอดยังเปลี่ยนได้ ต้องบอกไว้ ไม่งั้นคนโอนตามแล้วยอดขยับทีหลัง
 */
export function dayPaymentText({ clubName, dateLabel, total, perPerson, payers, live, club }) {
  const unpaid = payers.filter((p) => !p.paidAt).map((p) => p.name)
  const paid = payers.filter((p) => p.paidAt).map((p) => p.name)
  return [
    `🏸 ${clubName} — ${dateLabel}`,
    `รวม ${formatBaht(total)} บาท หาร ${payers.length} คน คนละ ${formatBaht(perPerson)} บาท`,
    live ? '(ยังไม่ปิดยอด ตัวเลขอาจเปลี่ยน)' : null,
    '',
    unpaid.length ? `ยังไม่จ่าย (${unpaid.length}): ${unpaid.join(', ')}` : 'จ่ายครบทุกคนแล้ว 🎉',
    paid.length ? `จ่ายแล้ว (${paid.length}): ${paid.join(', ')}` : null,
    promptPayLine(club),
  ]
    .filter((line) => line !== null)
    .join('\n')
}

/**
 * รวมแถวค้างจ่ายรายวัน (จาก v_club_outstanding) เป็นรายคน
 * สมาชิกรวมกันข้ามวันด้วย memberId, แขกไม่มี member จึงแยกเป็นรายการของวันนั้น
 * เรียงคนที่ค้างเยอะสุดขึ้นก่อน
 */
export function groupOutstanding(rows) {
  const byKey = new Map()
  for (const r of rows) {
    const key = r.memberId ?? `guest:${r.playerId}`
    const g = byKey.get(key) ?? { key, memberId: r.memberId, name: r.name, total: 0, days: [] }
    g.total += r.amount
    g.days.push(r)
    byKey.set(key, g)
  }
  return [...byKey.values()]
    .map((g) => ({ ...g, days: g.days.sort((a, b) => a.playDate.localeCompare(b.playDate)) }))
    .sort((a, b) => b.total - a.total)
}

/** ข้อความทวงยอดค้างของทั้งก๊วน */
export function outstandingText({ clubName, groups, club }) {
  const total = groups.reduce((s, g) => s + g.total, 0)
  return [
    `🏸 ${clubName} — ยอดค้างจ่าย`,
    // แขกไม่มีตัวตนข้ามวัน ชื่อซ้ำกันได้ ต้องบอกวันที่ด้วยถึงจะรู้ว่าใคร
    ...groups.map((g) => {
      const when = g.memberId
        ? g.days.length > 1 ? ` (${g.days.length} วัน)` : ''
        : ` (แขก ${thaiDate(g.days[0].playDate, { day: 'numeric', month: 'short' })})`
      return `${g.name} ${formatBaht(g.total)} บาท${when}`
    }),
    `รวม ${formatBaht(total)} บาท`,
    promptPayLine(club),
  ]
    .filter(Boolean)
    .join('\n')
}
