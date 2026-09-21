import assert from 'node:assert'
import { pickNextMatch, pairKey, winChance, skillRating } from '../src/utils/pairing.js'
import { byRanking } from '../src/utils/ranking.js'
const P = (id, skill, g = 0) => ({ id, skill, gamesPlayed: g, queuedAt: id })
const sum = (t) => t.reduce((s, p) => s + p.skill, 0)
// sequential: balanced split of first 4 (3+1 vs 2+2 -> gap 0)
let m = pickNextMatch([P(1, 3), P(2, 2), P(3, 2), P(4, 1), P(5, 3, 5)])
assert.equal(Math.abs(sum(m.teamA) - sum(m.teamB)), 0)
assert.deepEqual([...m.teamA, ...m.teamB].map((p) => p.id).sort(), [1, 2, 3, 4])
assert.equal(pickNextMatch([P(1, 1), P(2, 1), P(3, 1)]), null)
// rotate: avoid repeat partner 1&2
const stats = new Map([[pairKey(1, 2), { together: 3, against: 0 }]])
m = pickNextMatch([P(1, 2), P(2, 2), P(3, 2), P(4, 2)], { mode: 'rotate', pairStats: stats })
assert.ok(!m.teamA.some((p) => p.id === 1) || !m.teamA.some((p) => p.id === 2))
// rest rule: just-played players wait while >= 4 rested are available
const ids = (m) => [...m.teamA, ...m.teamB].map((p) => p.id).sort((x, y) => x - y)
const fresh = [P(1, 2, 3), P(2, 2, 3), P(3, 2, 3), P(4, 2, 3)]
const tired = [5, 6, 7, 8].map((i) => ({ ...P(i, 2, 1), rested: false }))
assert.deepEqual(ids(pickNextMatch([...tired, ...fresh])), [1, 2, 3, 4])
assert.deepEqual(ids(pickNextMatch([...tired, ...fresh], { mode: 'rotate', pairStats: stats })), [1, 2, 3, 4])
// fewer than 4 rested: take all rested, fill from tired — must not crash when the rested one has more games
m = pickNextMatch([{ ...P(9, 2, 6) }, ...tired], { mode: 'rotate', pairStats: stats })
assert.ok(ids(m).includes(9) && ids(m).length === 4)
// rating beats skill label: two "intermediates" rated like aces split across teams
const rated = [P(1, 2), P(2, 2), { ...P(3, 2), rating: 1300 }, { ...P(4, 2), rating: 1300 }]
m = pickNextMatch(rated)
assert.ok(m.teamA.some((p) => p.id >= 3) && m.teamB.some((p) => p.id >= 3))
assert.ok(Math.abs(winChance(m.teamA, m.teamB) - 0.5) < 1e-9)
assert.equal(skillRating(3), 1100)

// ranking: 8-2 beats 1-0 (below min games), win rate beats raw wins, point diff breaks ties
const R = (name, wins, losses, pointDiff = 0) => ({ name, wins, losses, pointDiff })
const order = [R('lucky', 1, 0), R('grinder', 6, 4), R('ace', 8, 2), R('twin+', 3, 1, 12), R('twin-', 3, 1, 5)]
  .sort(byRanking).map((r) => r.name)
assert.deepEqual(order, ['ace', 'twin+', 'twin-', 'grinder', 'lucky'])
console.log('pairing ok')
