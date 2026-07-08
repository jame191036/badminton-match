// Skill levels used across the app
export const SKILL_LEVELS = [
  { value: 1, label: 'มือใหม่' },
  { value: 2, label: 'มือกลาง' },
  { value: 3, label: 'มือเก่ง' },
]

export function skillLabel(value) {
  return SKILL_LEVELS.find((s) => s.value === value)?.label ?? '-'
}

// Given exactly 4 players, find the 2v2 split that minimizes the
// skill-sum gap between the two teams.
export function bestTeamSplit(fourPlayers) {
  const [a, b, c, d] = fourPlayers
  const combos = [
    { teamA: [a, b], teamB: [c, d] },
    { teamA: [a, c], teamB: [b, d] },
    { teamA: [a, d], teamB: [b, c] },
  ]
  let best = combos[0]
  let bestGap = Infinity
  for (const combo of combos) {
    const sumA = combo.teamA.reduce((s, p) => s + p.skill, 0)
    const sumB = combo.teamB.reduce((s, p) => s + p.skill, 0)
    const gap = Math.abs(sumA - sumB)
    if (gap < bestGap) {
      bestGap = gap
      best = combo
    }
  }
  return best
}

// Pick the 4 players who have waited longest / played least from the
// waiting pool, then split them into balanced teams.
export function pickNextMatch(waitingPlayers) {
  if (waitingPlayers.length < 4) return null

  const sorted = [...waitingPlayers].sort((p1, p2) => {
    if (p1.gamesPlayed !== p2.gamesPlayed) return p1.gamesPlayed - p2.gamesPlayed
    return p1.queuedAt - p2.queuedAt
  })

  const four = sorted.slice(0, 4)
  const { teamA, teamB } = bestTeamSplit(four)
  return { teamA, teamB, playerIds: four.map((p) => p.id) }
}
