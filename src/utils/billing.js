// หารเงิน — สูตรเดียวของทั้งแอป (แท็บหารเงิน, กล่องยอดที่ล็อก, รายงาน PDF/รูป)
// ยอดรวมต้องคิดตรงกับ v_billing_summary ใน SQL (ดู CLAUDE.md)

export function toNumber(v) {
  const n = parseFloat(v)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

export const formatBaht = (n) =>
  n.toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })

/** คนที่ต้องจ่าย: มาจริง (ไม่ใช่ absent) และไม่ได้ถูกติ๊กออกจากผู้ร่วมจ่าย */
export const isPayer = (p) => p.status !== 'absent' && p.paying !== false

/** วิธีหาร — ค่าตรงกับ sessions.split_mode ใน SQL */
export const SPLIT_MODES = [
  { value: 'equal', label: 'หารเท่ากัน', hint: 'ทุกคนที่มาจ่ายเท่ากัน ไม่ว่าจะได้เล่นกี่เกม' },
  { value: 'games', label: 'หารตามเกม', hint: 'ยิ่งเล่นมากยิ่งจ่ายมาก คนที่ไม่ได้ลงเล่นเลยไม่ต้องจ่าย' },
]

/**
 * แบ่งยอดรวมให้ผู้ร่วมจ่ายแต่ละคน
 *   equal  คนละ = รวม ÷ จำนวนผู้ร่วมจ่าย
 *   games  คนละ = รวม × เกมของคนนั้น ÷ เกมรวมของผู้ร่วมจ่าย  (= เกมละ × จำนวนเกมของตัวเอง)
 *
 * ผลรวมของทุกคนเท่ากับ total เสมอ — ยกเว้นหารตามเกมตอนที่ยังไม่มีใครจบเกมเลย (ทุกคน 0)
 * จำนวนเกมคือ gamesPlayed ซึ่ง finish_match นับเฉพาะคนที่เล่นจริง
 * (คนที่ถูกให้พักก่อนเริ่มเกมไม่ถูกนับ จึงไม่ต้องจ่ายเกมนั้น)
 *
 * วันที่จบแล้วส่ง total = final_total_fee ที่ล็อกไว้ ส่วนจำนวนเกม/สถานะของผู้เล่น
 * ถูก trigger ล็อกไว้แล้ว (migration 120) ยอดรายคนจึงนิ่งตาม
 */
export function splitShares({ players, total, splitMode = 'equal' }) {
  const payers = players.filter(isPayer)
  const payerGames = payers.reduce((s, p) => s + (p.gamesPlayed ?? 0), 0)
  const shares = new Map()

  if (splitMode === 'games') {
    const perGame = payerGames > 0 ? total / payerGames : 0
    for (const p of payers) shares.set(p.id, perGame * (p.gamesPlayed ?? 0))
    return { splitMode, shares, perPerson: null, perGame, payerCount: payers.length, payerGames }
  }

  const perPerson = payers.length > 0 ? total / payers.length : 0
  for (const p of payers) shares.set(p.id, perPerson)
  return { splitMode: 'equal', shares, perPerson, perGame: null, payerCount: payers.length, payerGames }
}

/**
 * ยอดสดของวันที่ยังไม่ปิด
 *   ค่าสนาม = Σ ชั่วโมงทุกคอร์ต × ราคา/ชม.   ค่าลูก = จำนวนลูก × ราคา/ลูก
 *   แล้วแบ่งให้แต่ละคนตามวิธีหารที่เลือก (splitShares)
 */
export function computeBilling({ players, courts, billing, splitMode = 'equal' }) {
  const hourlyRate = toNumber(billing.hourlyRate)
  const shuttlePrice = toNumber(billing.shuttlePrice)
  const shuttleCount = toNumber(billing.shuttleCount)
  const totalHours = courts.reduce((s, c) => s + toNumber(c.hours), 0)
  const courtTotal = totalHours * hourlyRate
  const shuttleTotal = shuttleCount * shuttlePrice
  const total = courtTotal + shuttleTotal
  return {
    hourlyRate,
    shuttleCount,
    totalHours,
    courtTotal,
    shuttleTotal,
    total,
    ...splitShares({ players, total, splitMode }),
  }
}
