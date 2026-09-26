import assert from 'node:assert'
import { pickNextMatch, pairKey, winChance, skillRating } from '../src/utils/pairing.js'
import { byRanking } from '../src/utils/ranking.js'
import { computeBilling, groupOutstanding, dayPaymentText, outstandingText } from '../src/utils/billing.js'
import { promptPayPayload, crc16, isPromptPayId } from '../src/utils/promptpay.js'
import { buildDayReport, reportColumns } from '../src/utils/report.js'
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
// forceRest: false — the same input that answers with the rested four now goes to
// the four with fewer games instead. This contrast is the whole point of the switch,
// and it is independent of the mode, so assert it for both.
for (const mode of ['sequential', 'rotate']) {
  const opts = { mode, pairStats: stats }
  assert.deepEqual(ids(pickNextMatch([...tired, ...fresh], opts)), [1, 2, 3, 4])
  assert.deepEqual(ids(pickNextMatch([...tired, ...fresh], { ...opts, forceRest: false })), [5, 6, 7, 8])
}
// the switch is also honoured before any pair history exists (first game of the day)
assert.deepEqual(ids(pickNextMatch([...tired, ...fresh], { forceRest: false })), [5, 6, 7, 8])
// rotate still avoids repeat partners with the rest rule off: 1&2 played together 3 times
m = pickNextMatch([P(1, 2), P(2, 2), P(3, 2), P(4, 2)], {
  mode: 'rotate',
  pairStats: stats,
  forceRest: false,
})
assert.ok(!m.teamA.some((p) => p.id === 1) || !m.teamA.some((p) => p.id === 2))
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
// billing: absent and non-paying excluded from the divisor, resting still pays
const who = [{ status: 'waiting' }, { status: 'resting' }, { status: 'absent' }, { status: 'playing', paying: false }]
const bill = computeBilling({ players: who, courts: [{ hours: 2 }, { hours: '1.5' }], billing: { hourlyRate: '200', shuttlePrice: '80', shuttleCount: '3' } })
assert.deepEqual([bill.total, bill.payerCount, bill.perPerson], [940, 2, 470])

// outstanding: members merge across days, guests stay per day, biggest debt first
const g = groupOutstanding([
  { memberId: 'm1', playerId: 'p1', name: 'Ae', playDate: '2026-09-20', amount: 130 },
  { memberId: 'm1', playerId: 'p2', name: 'Ae', playDate: '2026-09-13', amount: 120 },
  { memberId: null, playerId: 'p3', name: 'Guest', playDate: '2026-09-20', amount: 130 },
  { memberId: null, playerId: 'p4', name: 'Guest', playDate: '2026-09-13', amount: 120 },
])
assert.deepEqual(g.map((x) => [x.name, x.total, x.days.length]), [['Ae', 250, 2], ['Guest', 130, 1], ['Guest', 120, 1]])
assert.equal(g[0].days[0].playDate, '2026-09-13')
assert.ok(outstandingText({ clubName: 'C', groups: g, club: {} }).includes('Guest 130 บาท (แขก 20 ก.ย.)'))
assert.ok(dayPaymentText({ clubName: 'C', dateLabel: 'd', total: 260, perPerson: 130, live: true,
  payers: [{ name: 'Ae', paidAt: 'x' }, { name: 'Bee' }], club: { promptpayId: '0812345678' } }).includes('ยังไม่จ่าย (1): Bee'))

// PromptPay: CRC standard check value + payloads matched against the promptpay-qr library
assert.equal(crc16('123456789'), '29B1')
assert.equal(promptPayPayload('0812345678'), '00020101021129370016A000000677010111011300668123456785802TH530376463045D82')
assert.equal(promptPayPayload('0812345678', 130), '00020101021229370016A000000677010111011300668123456785802TH53037645406130.00630496CE')
assert.ok(isPromptPayId('0812345678') && isPromptPayId('1234567890123') && !isPromptPayId('081234567'))

// variety: partner freshness wins outright, so the pair that has played together
// must be split even when that means reaching past the head of the queue
const vStats = new Map([
  [pairKey(1, 2), { together: 5, against: 0 }],
  [pairKey(3, 4), { together: 5, against: 0 }],
])
m = pickNextMatch([P(1, 2), P(2, 2), P(3, 2), P(4, 2)], { mode: 'variety', pairStats: vStats })
const together = (x, y) => [m.teamA, m.teamB].some((t) => t.some((p) => p.id === x) && t.some((p) => p.id === y))
assert.ok(!together(1, 2) && !together(3, 4))
// the force-rest switch must not change anything in this mode
const varietyIds = (fr) =>
  ids(pickNextMatch([...tired, ...fresh], { mode: 'variety', pairStats: stats, forceRest: fr }))
assert.deepEqual(varietyIds(true), varietyIds(false))

// variety must still not starve anyone: a player who has partnered everyone costs a
// repeat penalty every time, so without a hard cap the weighted score skips them
// forever (a simulated 8-player, 20-game day left them on 0). The cap is a forced
// inclusion, NOT a pool filter — filtering stops binding once only one player is
// behind, because the pool then falls under four and has to be widened again.
const starved = [
  { ...P(1, 2, 0) },
  ...[2, 3, 4, 5, 6, 7, 8].map((i) => P(i, 2, 9)),
]
const far = new Map([2, 3, 4, 5, 6, 7, 8].map((i) => [pairKey(1, i), { together: 4, against: 4 }]))
assert.ok(ids(pickNextMatch(starved, { mode: 'variety', pairStats: far })).includes(1))

// report: a closed day must read the frozen totals, an open day the live ones —
// the PDF and the PNG share this one model, so a slip here shows up in both
const REP = {
  players: [
    { name: 'Ae', status: 'waiting', gamesPlayed: 5, minutesPlayed: 60, wins: 3, losses: 1, pointDiff: 9 },
    { name: 'Bee', status: 'waiting', gamesPlayed: 2, minutesPlayed: 20, wins: 0, losses: 0, pointDiff: 0 },
    { name: 'Cee', status: 'absent', gamesPlayed: 0, minutesPlayed: 0, wins: 0, losses: 0, pointDiff: 0 },
  ],
  summary: { finishedGames: 7, totalPlayMinutes: 80 },
  billing: { total: 999, perPerson: 499.5, payerCount: 2 },
  clubName: 'ก๊วนทดสอบ',
}
const openDay = { playDate: '2026-09-26', status: 'playing', startTime: '19:00:00', endTime: '21:00:00', venueName: 'สนาม A', finals: {} }
const frozen = { totalFee: 500, perPerson: 250, payerCount: 2 }

let rep = buildDayReport({ ...REP, day: openDay })
assert.equal(rep.tiles[2].value, '999 บาท') // ยังไม่จบ = ยอดสด
assert.deepEqual(rep.rows.map((r) => r.name), ['Ae', 'Bee']) // absent ไม่อยู่ในรายงาน
assert.deepEqual(rep.rows.map((r) => r.pos), [1, 2])
assert.ok(rep.notes.some((n) => n.includes('ไม่มา')) && rep.notes.some((n) => n.includes('ยังไม่จบ')))

rep = buildDayReport({ ...REP, day: { ...openDay, status: 'done', finals: frozen } })
assert.equal(rep.tiles[2].value, '500 บาท') // จบแล้ว = ยอดที่ freeze ไว้
assert.equal(rep.tiles[3].value, '250 บาท')
assert.ok(!rep.notes.some((n) => n.includes('ยังไม่จบ')))
// ไม่มีใครจดแต้ม -> ไม่ต้องมีคอลัมน์ชนะ-แพ้
assert.ok(!reportColumns(buildDayReport({
  ...REP,
  players: REP.players.map((p) => ({ ...p, wins: 0, losses: 0 })),
  day: openDay,
}).hasScores).some((c) => c.key === 'record'))
assert.ok(reportColumns(true).some((c) => c.key === 'record'))

console.log('pairing ok')
