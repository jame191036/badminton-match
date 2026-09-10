import { useAuth } from './hooks/useAuth'
import { useGameSession } from './hooks/useGameSession'
import { useBadmintonData } from './hooks/useBadmintonData'
import { useMembers } from './hooks/useMembers'
import { useTheme } from './hooks/useTheme'
import PlayerForm from './components/PlayerForm'
import PlayerQueue from './components/PlayerQueue'
import CourtBoard from './components/CourtBoard'
import MatchHistory from './components/MatchHistory'
import SessionStats from './components/SessionStats'
import SessionBar from './components/SessionBar'
import SessionArchive from './components/SessionArchive'
import NewSessionPanel from './components/NewSessionPanel'
import BillingPanel from './components/BillingPanel'
import ThemeToggle from './components/ThemeToggle'
import Login from './components/Login'
import './app.css'

export default function App() {
  const { theme, toggleTheme } = useTheme()
  const { user, loading: authLoading, signInWithEmail, signOut } = useAuth()
  const {
    sessionId,
    sessionName,
    billing,
    updateBilling,
    queueMode,
    updateQueueMode,
    renameSession,
    closeSession,
    openSession,
    archive,
  } = useGameSession(user?.id)
  const { members, refetch: refetchMembers } = useMembers(user?.id)
  const {
    players,
    courts,
    history,
    summary,
    addPlayer,
    removePlayer,
    togglePaying,
    toggleRest,
    addCourt,
    removeCourt,
    updateCourtHours,
    assignCourt,
    startMatch,
    substitutePlayer,
    cancelMatch,
    finishMatch,
  } = useBadmintonData(sessionId, queueMode)

  const waitingCount = players.filter((p) => p.status === 'waiting').length

  if (authLoading) return null
  if (!user) return <Login onSignIn={signInWithEmail} />

  const header = (
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
  )

  // ปิดก๊วนแล้วยังไม่ได้เปิดใหม่ — ให้เลือกสมาชิกก่อนถึงจะเข้าหน้าหลักได้
  if (!sessionId) {
    return (
      <div className="app-shell">
        {header}
        <main className="app-main">
          <section className="panel">
            <NewSessionPanel
              members={members}
              onOpen={async (name, memberIds) => {
                await openSession(name, memberIds)
                await refetchMembers()
              }}
            />
          </section>

          {archive.length > 0 && (
            <>
              <div className="net-divider" />
              <section className="panel">
                <h2>ก๊วนที่ผ่านมา</h2>
                <SessionArchive archive={archive} />
              </section>
            </>
          )}
        </main>
      </div>
    )
  }

  return (
    <div className="app-shell">
      {header}

      <main className="app-main">
        <SessionBar name={sessionName} onRename={renameSession} onClose={closeSession} />

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
            onStart={startMatch}
            onSubstitute={substitutePlayer}
            onCancel={cancelMatch}
            onFinish={finishMatch}
            onAddCourt={addCourt}
            onRemoveCourt={removeCourt}
            queueMode={queueMode}
            onChangeQueueMode={updateQueueMode}
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
            courts={courts}
            billing={billing}
            onChangeBilling={updateBilling}
            onTogglePaying={togglePaying}
            onChangeCourtHours={updateCourtHours}
          />
        </section>

        <div className="net-divider" />

        <section className="panel">
          <h2>สถิติวันนี้</h2>
          <SessionStats players={players} summary={summary} />
        </section>

        <div className="net-divider" />

        <section className="panel">
          <h2>ประวัติการแข่งขัน</h2>
          <MatchHistory history={history} />
        </section>

        <div className="net-divider" />

        <section className="panel">
          <h2>ก๊วนที่ผ่านมา</h2>
          <SessionArchive archive={archive} />
        </section>
      </main>

      <footer className="app-footer">
        <p>ข้อมูลซิงก์กับบัญชีของคุณผ่าน Supabase — ใช้ได้หลายอุปกรณ์พร้อมกัน</p>
      </footer>
    </div>
  )
}
