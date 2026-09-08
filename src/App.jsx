import { useAuth } from './hooks/useAuth'
import { useGameSession } from './hooks/useGameSession'
import { useBadmintonData } from './hooks/useBadmintonData'
import { useTheme } from './hooks/useTheme'
import PlayerForm from './components/PlayerForm'
import PlayerQueue from './components/PlayerQueue'
import CourtBoard from './components/CourtBoard'
import MatchHistory from './components/MatchHistory'
import BillingPanel from './components/BillingPanel'
import ThemeToggle from './components/ThemeToggle'
import Login from './components/Login'
import './app.css'

export default function App() {
  const { theme, toggleTheme } = useTheme()
  const { user, loading: authLoading, signInWithEmail, signOut } = useAuth()
  const { sessionId, billing, updateBilling } = useGameSession(user?.id)
  const {
    players,
    courts,
    history,
    addPlayer,
    removePlayer,
    togglePaying,
    toggleRest,
    addCourt,
    removeCourt,
    assignCourt,
    finishMatch,
  } = useBadmintonData(sessionId)

  const waitingCount = players.filter((p) => p.status === 'waiting').length

  if (authLoading) return null
  if (!user) return <Login onSignIn={signInWithEmail} />

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-top">
          <button
            className="btn-ghost"
            onClick={signOut}
            style={{ marginRight: 8, color: 'var(--header-text)', borderColor: 'rgba(255,255,255,0.35)' }}
          >
            ออกจากระบบ
          </button>
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
            onChangeBilling={updateBilling}
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
        <p>ข้อมูลซิงก์กับบัญชีของคุณผ่าน Supabase — ใช้ได้หลายอุปกรณ์พร้อมกัน</p>
      </footer>
    </div>
  )
}
