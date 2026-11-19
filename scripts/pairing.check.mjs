import assert from 'node:assert'
import { pickNextMatch, pairKey, repeatGroupReason } from '../src/utils/pairing.js'
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

// rest rule, filling from the four who just finished the SAME game: they rested exactly
// as long as each other, so queue order between them is meaningless (finish_match hands
// out queue_seq in table-row order, the same order every time). Breaking that tie by
// queuedAt sent the same two people straight back on every game — simulated 10 players
// on 2 courts: 11 games vs 6, and those two shared every court. Fewer games must win the
// tie instead (1,2 have 6 games, 3,4 have 5 — queue order alone would take 1,2).
const R1 = { ...P(21, 2, 5) }
const R2 = { ...P(22, 2, 5) }
const sameGame = (id, g) => ({ ...P(id, 2, g), queuedAt: 10 + id, rested: false, lastEndedAt: 100 })
const justDone = [sameGame(1, 6), sameGame(2, 6), sameGame(3, 5), sameGame(4, 5)]
for (const mode of ['sequential', 'rotate']) {
  assert.deepEqual(ids(pickNextMatch([R1, R2, ...justDone], { mode, pairStats: stats })), [3, 4, 21, 22])
}
// ...and with games equal, rotate picks from the tie by pair freshness: 1 and 2 have
// already partnered both rested players, so 3 and 4 go even though they queue later
const evenDone = [1, 2, 3, 4].map((i) => sameGame(i, 5))
const stale = new Map([1, 2].flatMap((i) => [21, 22].map((r) => [pairKey(i, r), { together: 2, against: 1 }])))
assert.deepEqual(ids(pickNextMatch([R1, R2, ...evenDone], { mode: 'rotate', pairStats: stale })), [3, 4, 21, 22])
// the tie never overrides "longest resting": 5 came off earlier, so 5 goes despite 9 games
const earlier = { ...P(5, 2, 9), rested: false, lastEndedAt: 50 }
m = pickNextMatch([R1, R2, earlier, ...evenDone], { mode: 'rotate', pairStats: stale })
assert.ok([5, 21, 22].every((id) => ids(m).includes(id)))

// everyone waiting fits on the free courts (8 players, both courts free): rest and games
// cannot change who plays, only who plays with whom — so the two foursomes must mix.
// With one free court the rest rule still sends the longer-rested group as a block.
const groupX = [1, 2, 3, 4].map((i) => ({ ...P(i, 2, 3), rested: false, lastEndedAt: 100 }))
const groupY = [5, 6, 7, 8].map((i) => ({ ...P(i, 2, 2), rested: false, lastEndedAt: 200 }))
const within = new Map(
  [[1, 2, 3, 4], [5, 6, 7, 8]].flatMap((g) =>
    g.flatMap((a, i) => g.slice(i + 1).map((b) => [pairKey(a, b), { together: 2, against: 4 }])),
  ),
)
const eight = [...groupX, ...groupY]
assert.deepEqual(ids(pickNextMatch(eight, { mode: 'rotate', pairStats: within })), [1, 2, 3, 4])
const mixed = ids(pickNextMatch(eight, { mode: 'rotate', pairStats: within, freeCourts: 2 }))
assert.equal(mixed.filter((id) => id <= 4).length, 2)

// repeat-group warning: say WHY the four who just played together are coming back, and
// only when something can be done about it — a warning on every pick would be ignored
const warn = (players, opts) => repeatGroupReason(players, { mode: 'rotate', pairStats: within, ...opts })
// 12 players on 2 courts: the rest rule narrows eight waiting down to one whole foursome
assert.equal(warn(eight, { busyCourts: 1 }), 'rest')
// rest off, the same foursome may still come (fewer games) but the rest rule is not why
assert.equal(warn(eight, { busyCourts: 1, forceRest: false }), null)
// both courts free: everyone plays now, the pick mixes, nothing to warn about
assert.equal(warn(eight, { freeCourts: 2 }), null)
// 8 players, other court still playing: only the four who just finished are free
assert.equal(warn(groupY, { busyCourts: 1 }), 'wait')
assert.equal(warn(groupY, { busyCourts: 1, mode: 'variety' }), 'wait')
assert.equal(warn(groupY, { busyCourts: 0 }), null) // nothing to wait for
// not the same group: four whose last games were different matches
assert.equal(warn([groupX[0], groupX[1], groupY[0], groupY[1]], { busyCourts: 1 }), null)
// sequential repeats groups by design; the first game of the day has no group to repeat
assert.equal(warn(groupY, { busyCourts: 1, mode: 'sequential' }), null)
assert.equal(warn([1, 2, 3, 4].map((i) => P(i, 2)), { busyCourts: 1 }), null)

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
    { name: 'Ae', status: 'waiting', gamesPlayed: 5, minutesPlayed: 60 },
    { name: 'Bee', status: 'waiting', gamesPlayed: 2, minutesPlayed: 20 },
    { name: 'Cee', status: 'absent', gamesPlayed: 0, minutesPlayed: 0 },
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
// ทุกคอลัมน์ต้องมีค่าในทุกแถว ไม่งั้น PDF กับรูปจะมีช่องว่างโผล่
assert.ok(reportColumns().every((c) => rep.rows.every((r) => r[c.key] !== undefined)))

console.log('pairing ok')
