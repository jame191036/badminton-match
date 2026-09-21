// Skill levels used across the app
export const SKILL_LEVELS = [
  { value: 1, label: 'มือใหม่' },
  { value: 2, label: 'มือกลาง' },
  { value: 3, label: 'มือเก่ง' },
]

export function skillLabel(value) {
  return SKILL_LEVELS.find((s) => s.value === value)?.label ?? '-'
}

// rotate อยู่ก่อนเพราะเป็นค่าเริ่มของวันใหม่ — sequential เอา 4 คนที่จบเกมพร้อมกัน
// กลับลงไปด้วยกันเรื่อย ๆ ถ้าคนเต็มคอร์ตพอดี (8, 12, 16) จะได้คู่เดิมทั้งวัน
export const QUEUE_MODES = [
  { value: 'rotate', label: 'สลับคู่', hint: 'เลี่ยงการเจอคู่เดิมซ้ำ ๆ' },
  { value: 'sequential', label: 'ตามลำดับคิว', hint: 'เอา 4 คนแรกในคิวลงเลย — คู่เดิมมักวนมาเจอกัน' },
]

// น้ำหนักของโหมด rotate — ปรับตรงนี้ได้ถ้ารู้สึกว่ามันสลับมาก/น้อยเกินไป
const WEIGHT = {
  together: 10, // เคยอยู่ทีมเดียวกัน — สิ่งที่อยากเลี่ยงที่สุด
  against: 3, //  เคยเจอกันคนละฝั่ง — เลี่ยงรองลงมา
  skillGap: 4, //  ผลต่างฝีมือของสองทีม (4 = ลดเกมเก่งคู่เก่งชนมือใหม่ โดยยังสลับคู่ได้พอ ๆ เดิม)
  queueSkip: 1, // ข้ามคิวคนที่รออยู่ก่อน — กันไม่ให้เลี่ยงคู่ซ้ำจนคิวเพี้ยน
}

// จำนวนคนหัวคิวที่หยิบมาพิจารณาในโหมด rotate
// ยิ่งกว้างยิ่งเลี่ยงคู่ซ้ำได้ดี แต่ก็ข้ามคิวได้ไกลขึ้น
const ROTATE_WINDOW = 8

export function pairKey(id1, id2) {
  return id1 < id2 ? `${id1}|${id2}` : `${id2}|${id1}`
}

function lookupPair(pairStats, id1, id2) {
  return pairStats?.get(pairKey(id1, id2)) ?? { together: 0, against: 0 }
}

// เรียงตามความเป็นธรรม: เล่นน้อยสุดก่อน ถ้าเท่ากันเอาคนที่รอนานกว่า
function byFairness(p1, p2) {
  if (p1.gamesPlayed !== p2.gamesPlayed) return p1.gamesPlayed - p2.gamesPlayed
  return p1.queuedAt - p2.queuedAt
}

function skillGap({ teamA, teamB }) {
  const sumA = teamA.reduce((s, p) => s + p.skill, 0)
  const sumB = teamB.reduce((s, p) => s + p.skill, 0)
  return Math.abs(sumA - sumB)
}

// ยิ่งคะแนนต่ำยิ่งดี
function scoreSplit(split, pairStats, queueSkip) {
  let together = 0
  let against = 0

  for (const team of [split.teamA, split.teamB]) {
    const [p1, p2] = team
    together += lookupPair(pairStats, p1.id, p2.id).together
  }

  for (const p1 of split.teamA) {
    for (const p2 of split.teamB) {
      against += lookupPair(pairStats, p1.id, p2.id).against
    }
  }

  return (
    together * WEIGHT.together +
    against * WEIGHT.against +
    skillGap(split) * WEIGHT.skillGap +
    queueSkip * WEIGHT.queueSkip
  )
}

/**
 * วงผู้เล่นที่หยิบมาพิจารณาในโหมด rotate
 *
 * ตัดคนที่เล่นไปมากกว่า "คนที่ 4 จากล่างสุด" ออกเลย — ไม่มีเหตุผลให้คนที่
 * เล่นเยอะกว่าลงก่อน ในเมื่อยังมีคนอื่นที่เล่นน้อยกว่าครบ 4 คนอยู่แล้ว
 * ที่เหลือค่อยเอา ROTATE_WINDOW คนแรกมาลองจับดู
 */
function fairPool(sorted) {
  const cap = sorted[3].gamesPlayed
  return sorted.filter((p) => p.gamesPlayed <= cap).slice(0, ROTATE_WINDOW)
}

// ทุกวิธีเลือก 4 คนจากรายชื่อ (คืน index มาด้วยเพื่อคิดค่าข้ามคิว)
function* chooseFour(list) {
  for (let i = 0; i < list.length - 3; i++)
    for (let j = i + 1; j < list.length - 2; j++)
      for (let k = j + 1; k < list.length - 1; k++)
        for (let l = k + 1; l < list.length; l++)
          yield { players: [list[i], list[j], list[k], list[l]], indices: [i, j, k, l] }
}

function splitsOf(four) {
  const [a, b, c, d] = four
  return [
    { teamA: [a, b], teamB: [c, d] },
    { teamA: [a, c], teamB: [b, d] },
    { teamA: [a, d], teamB: [b, c] },
  ]
}

// Pick the 4 players who have waited longest / played least from the
// waiting pool, then split them into balanced teams.
//
// mode 'rotate' จะดูคนหัวคิวกว้างขึ้น (ROTATE_WINDOW คน) แล้วเลือกชุดที่
// ให้คะแนนรวมต่ำสุด — คู่ซ้ำแพงสุด รองมาคือเจอกันซ้ำ ฝีมือห่าง และข้ามคิว
// การเลี่ยงคู่ซ้ำเป็น soft constraint เสมอ: ถ้าเหลือรอคิวพอดี 4 คน
// ก็ยังจับได้ตามปกติ ไม่มีทางที่ระบบจะปฏิเสธการจับคู่เพราะคู่ซ้ำ
export function pickNextMatch(waitingPlayers, options = {}) {
  if (waitingPlayers.length < 4) return null

  const { mode = 'sequential', pairStats = null } = options
  const sorted = [...waitingPlayers].sort(byFairness)

  if (mode !== 'rotate' || !pairStats || pairStats.size === 0) {
    // 2v2 ที่ผลรวมฝีมือสองทีมห่างกันน้อยสุด (เท่ากันเอาแบบแรก)
    return splitsOf(sorted.slice(0, 4)).reduce((best, s) => (skillGap(s) < skillGap(best) ? s : best))
  }

  const window = fairPool(sorted)

  let best = null
  let bestGames = Infinity
  let bestScore = Infinity

  for (const { players, indices } of chooseFour(window)) {
    // 0,1,2,3 คือชุดหัวคิวพอดี = ไม่ข้ามใครเลย
    const queueSkip = indices.reduce((s, idx) => s + idx, 0) - 6
    const totalGames = players.reduce((s, p) => s + p.gamesPlayed, 0)

    // ชุดที่เล่นรวมกันน้อยกว่าชนะเสมอ ไม่ว่าคะแนนคู่ซ้ำจะเป็นเท่าไหร่
    // (ถ้าเอาสองอย่างมาบวกกันด้วยน้ำหนัก คนที่เคยจับคู่กับทุกคนในวงแล้ว
    //  จะโดนข้ามไปเรื่อย ๆ เพราะค่าคู่ซ้ำแพงกว่าค่าตกคิวอยู่ตลอด)
    if (totalGames > bestGames) continue

    for (const split of splitsOf(players)) {
      const score = scoreSplit(split, pairStats, queueSkip)
      if (totalGames < bestGames || score < bestScore) {
        bestGames = totalGames
        bestScore = score
        best = split
      }
    }
  }

  return best
}
