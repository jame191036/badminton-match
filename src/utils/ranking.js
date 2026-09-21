// การจัดอันดับแพ้/ชนะ — ใช้ทั้งสถิติรายวันและอันดับรวมของก๊วน
// รับแถว { wins, losses, pointDiff } นับเฉพาะเกมที่กรอกแต้ม

// เล่นไม่ถึงเท่านี้ยังไม่มีอันดับ — ผลจากเกมเดียวสองเกมยังบอกอะไรไม่ได้
// (ชนะเกมเดียวได้ 100%, rating ยังขยับจากค่าตั้งต้นไม่พอ) ไปต่อท้ายไว้ก่อน
export const MIN_RANKED_GAMES = 3

export const scoredGames = (r) => r.wins + r.losses

export const winRate = (r) => (scoredGames(r) > 0 ? r.wins / scoredGames(r) : 0)

/**
 * อันดับรวมของก๊วน: ครบเกมขั้นต่ำก่อน → rating (ความเก่งที่เรียนรู้จากแต้ม) → จำนวนชนะ
 * ไม่ใช้ % ชนะ เพราะพอจับคู่ให้สูสีได้จริง ทุกคนจะชนะราว 50% จนแยกใครเก่งไม่ออก
 */
export function byRating(a, b) {
  const qa = scoredGames(a) >= MIN_RANKED_GAMES
  const qb = scoredGames(b) >= MIN_RANKED_GAMES
  if (qa !== qb) return qa ? -1 : 1
  return b.rating - a.rating || b.wins - a.wins
}

/** ผลงานรายวัน: ครบเกมขั้นต่ำก่อน → % ชนะ → จำนวนชนะ → แต้มได้-เสีย */
export function byRanking(a, b) {
  const qa = scoredGames(a) >= MIN_RANKED_GAMES
  const qb = scoredGames(b) >= MIN_RANKED_GAMES
  if (qa !== qb) return qa ? -1 : 1
  return winRate(b) - winRate(a) || b.wins - a.wins || b.pointDiff - a.pointDiff
}
