// การจัดอันดับแพ้/ชนะ — ใช้ทั้งสถิติรายวันและอันดับรวมของก๊วน
// รับแถว { wins, losses, pointDiff } นับเฉพาะเกมที่กรอกแต้ม

// เล่นไม่ถึงเท่านี้ยังไม่จัดอันดับด้วยเปอร์เซ็นต์ชนะ ไม่งั้นคนที่ชนะเกมเดียว (100%)
// จะนำหน้าคนที่ชนะ 8 ใน 10 ทันที — ไปต่อท้ายตามจำนวนชนะแทน
export const MIN_RANKED_GAMES = 3

export const scoredGames = (r) => r.wins + r.losses

export const winRate = (r) => (scoredGames(r) > 0 ? r.wins / scoredGames(r) : 0)

/** ครบเกมขั้นต่ำก่อน → % ชนะ → จำนวนชนะ → แต้มได้-เสีย */
export function byRanking(a, b) {
  const qa = scoredGames(a) >= MIN_RANKED_GAMES
  const qb = scoredGames(b) >= MIN_RANKED_GAMES
  if (qa !== qb) return qa ? -1 : 1
  return winRate(b) - winRate(a) || b.wins - a.wins || b.pointDiff - a.pointDiff
}
