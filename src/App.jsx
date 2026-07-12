import { useMemo, useState } from 'react'
import { useLocalStorage } from './hooks/useLocalStorage'
import { useTheme } from './hooks/useTheme'
import { pickNextMatch } from './utils/pairing'
import PlayerForm from './components/PlayerForm'
import PlayerQueue from './components/PlayerQueue'
import CourtBoard from './components/CourtBoard'
import MatchHistory from './components/MatchHistory'
import BillingPanel from './components/BillingPanel'
import ThemeToggle from './components/ThemeToggle'
import './app.css'

function makeInitialCourts() {
  return [
    { id: crypto.randomUUID(), name: 'คอร์ต 1', match: null },
    { id: crypto.randomUUID(), name: 'คอร์ต 2', match: null },
  ]
}

export default function App() {
  const { theme, toggleTheme } = useTheme()
  const [players, setPlayers] = useLocalStorage('badminton:players', [])
  const [courts, setCourts] = useLocalStorage('badminton:courts', makeInitialCourts())
  const [history, setHistory] = useLocalStorage('badminton:history', [])
  const [billing, setBilling] = useLocalStorage('badminton:billing', { courtFee: '', shuttleFee: '' })
  const [queueSeq, setQueueSeq] = useState(0)

  const waitingCount = useMemo(
    () => players.filter((p) => p.status === 'waiting').length,
    [players]
  )

  function addPlayer(name, skill) {
    setPlayers((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        name,
        skill,
        gamesPlayed: 0,
        queuedAt: Date.now() + queueSeq,
        status: 'waiting',
        paying: true,
      },
    ])
    setQueueSeq((s) => s + 1)
  }

  function togglePaying(id) {
    setPlayers((prev) =>
      prev.map((p) => (p.id === id ? { ...p, paying: !(p.paying !== false) } : p))
    )
  }

  function toggleRest(id) {
    setPlayers((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p
        if (p.status === 'resting') {
          return { ...p, status: 'waiting', queuedAt: Date.now() + queueSeq }
        }
        return { ...p, status: 'resting' }
      })
    )
    setQueueSeq((s) => s + 1)
  }

  function removePlayer(id) {
    setPlayers((prev) => prev.filter((p) => p.id !== id))
  }

  function assignCourt(courtId) {
    const waiting = players.filter((p) => p.status === 'waiting')
    const match = pickNextMatch(waiting)
    if (!match) return

    setPlayers((prev) =>
      prev.map((p) =>
        match.playerIds.includes(p.id) ? { ...p, status: 'playing' } : p
      )
    )
    setCourts((prev) =>
      prev.map((c) => (c.id === courtId ? { ...c, match } : c))
    )
  }

  function finishMatch(courtId) {
    const court = courts.find((c) => c.id === courtId)
    if (!court?.match) return
    const { teamA, teamB } = court.match
    const playedIds = new Set([...teamA, ...teamB].map((p) => p.id))

    setPlayers((prev) =>
      prev.map((p) =>
        playedIds.has(p.id)
          ? { ...p, status: 'waiting', gamesPlayed: p.gamesPlayed + 1, queuedAt: Date.now() + queueSeq }
          : p
      )
    )
    setQueueSeq((s) => s + 1)

    setHistory((prev) => [
      {
        id: crypto.randomUUID(),
        time: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }),
        courtName: court.name,
        teamA: teamA.map((p) => p.name),
        teamB: teamB.map((p) => p.name),
      },
      ...prev,
    ].slice(0, 30))

    setCourts((prev) => prev.map((c) => (c.id === courtId ? { ...c, match: null } : c)))
  }

  function addCourt() {
    setCourts((prev) => [
      ...prev,
      { id: crypto.randomUUID(), name: `คอร์ต ${prev.length + 1}`, match: null },
    ])
  }

  function removeCourt() {
    setCourts((prev) => {
      if (prev.length <= 1) return prev
      const last = prev[prev.length - 1]
      if (last.match) {
        // return players from that court's match to the waiting queue first
        const ids = new Set([...last.match.teamA, ...last.match.teamB].map((p) => p.id))
        setPlayers((players2) =>
          players2.map((p) => (ids.has(p.id) ? { ...p, status: 'waiting' } : p))
        )
      }
      return prev.slice(0, -1)
    })
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-top">
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
        <div className="header-inner">
          <span className="eyebrow mono">จัดก๊วนแบด</span>
          <h1 className="display">จับคู่ลงคอร์ต 🏸</h1>
          <p className="header-sub">เพิ่มผู้เล่น ระบบจะจัดคิวและจับคู่ดับเบิลให้อัตโนมัติ วนเวียนอย่างเป็นธรรม</p>
        </div>
      </header>

      <main className="app-main">
        <section className="panel">
          <h2>เพิ่มผู้เล่น</h2>
          <PlayerForm onAdd={addPlayer} />
        </section>

        <div className="net-divider" />

        <section className="panel">
          <CourtBoard
            courts={courts}
            waitingCount={waitingCount}
            onAssign={assignCourt}
            onFinish={finishMatch}
            onAddCourt={addCourt}
            onRemoveCourt={removeCourt}
          />
        </section>

        <div className="net-divider" />

        <section className="panel">
          <PlayerQueue players={players} onToggleRest={toggleRest} onRemove={removePlayer} />
        </section>

        <div className="net-divider" />

        <section className="panel">
          <h2>คิดเงิน</h2>
          <BillingPanel
            players={players}
            billing={billing}
            onChangeBilling={setBilling}
            onTogglePaying={togglePaying}
          />
        </section>

        <div className="net-divider" />

        <section className="panel">
          <h2>ประวัติการแข่งขัน</h2>
          <MatchHistory history={history} />
        </section>
      </main>

      <footer className="app-footer">
        <p>ข้อมูลถูกบันทึกไว้ในเบราว์เซอร์นี้เท่านั้น (localStorage)</p>
      </footer>
    </div>
  )
}
