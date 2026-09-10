import { useEffect, useState } from 'react'
import { QUEUE_MODES, skillLabel } from '../utils/pairing'

// นาฬิกาเดินตัวเดียวใช้ร่วมกันทุกคอร์ต ดีกว่าให้แต่ละคอร์ตตั้ง interval เอง
function useNow(active) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [active])

  return now
}

function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const mm = String(Math.floor(total / 60)).padStart(2, '0')
  const ss = String(total % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

function TeamSide({ team, label, onSubstitute }) {
  return (
    <div className="team-side">
      <span className="team-label mono">{label}</span>
      {team.map((p) => (
        <div key={p.id} className="team-player">
          <span>{p.name}</span>
          <span className="team-skill mono">{skillLabel(p.skill)}</span>
          {onSubstitute && (
            <button
              className="btn-ghost btn-sub"
              onClick={() => onSubstitute(p.id)}
              title="ยังไม่พร้อม — พักก่อน แล้วให้คนถัดไปในคิวมาแทน"
            >
              พัก
            </button>
          )}
        </div>
      ))}
      {/* ที่ว่างจากการสลับตัวโดยไม่มีใครในคิวมาแทน */}
      {Array.from({ length: Math.max(0, 2 - team.length) }, (_, i) => (
        <div key={`empty-${i}`} className="team-player team-player-empty">
          <span>รอคนแทน</span>
        </div>
      ))}
    </div>
  )
}

export default function CourtBoard({
  courts,
  waitingCount,
  onAssign,
  onStart,
  onSubstitute,
  onCancel,
  onFinish,
  onAddCourt,
  onRemoveCourt,
  queueMode,
  onChangeQueueMode,
}) {
  const hasRunning = courts.some((c) => c.match?.status === 'playing')
  const now = useNow(hasRunning)

  return (
    <div className="court-board">
      <div className="court-board-head">
        <h3>คอร์ต</h3>
        <div className="court-controls">
          <button className="btn-ghost" onClick={onRemoveCourt} disabled={courts.length <= 1}>− คอร์ต</button>
          <span className="mono">{courts.length} คอร์ต</span>
          <button className="btn-ghost" onClick={onAddCourt}>+ คอร์ต</button>
        </div>
      </div>

      <div className="queue-mode">
        <span className="queue-mode-label">วิธีจับคู่</span>
        <div className="queue-mode-options" role="group" aria-label="วิธีจับคู่">
          {QUEUE_MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              className={`queue-mode-btn ${queueMode === m.value ? 'active' : ''}`}
              aria-pressed={queueMode === m.value}
              onClick={() => onChangeQueueMode(m.value)}
              title={m.hint}
            >
              {m.label}
            </button>
          ))}
        </div>
        <span className="queue-mode-hint">
          {QUEUE_MODES.find((m) => m.value === queueMode)?.hint}
        </span>
      </div>

      <div className="court-grid">
        {courts.map((court) => {
          const match = court.match
          const isPending = match?.status === 'pending'
          const playerCount = match ? match.teamA.length + match.teamB.length : 0

          return (
            <div
              key={court.id}
              className={`court-card ${match ? (isPending ? 'pending' : 'occupied') : 'empty'}`}
            >
              <div className="court-head">
                <span className="court-name display">{court.name}</span>
                {match && (
                  <span className={`court-status mono ${isPending ? 'is-pending' : 'is-playing'}`}>
                    {isPending
                      ? 'รอเริ่มเกม'
                      : formatElapsed(now - (match.startedAt ?? now))}
                  </span>
                )}
              </div>

              {match ? (
                <>
                  <div className="court-match">
                    <TeamSide
                      team={match.teamA}
                      label="ฝั่ง A"
                      onSubstitute={isPending ? (pid) => onSubstitute(court.id, pid) : null}
                    />
                    <div className="vs mono">VS</div>
                    <TeamSide
                      team={match.teamB}
                      label="ฝั่ง B"
                      onSubstitute={isPending ? (pid) => onSubstitute(court.id, pid) : null}
                    />
                  </div>

                  {isPending ? (
                    <>
                      {playerCount < 4 && (
                        <p className="court-warn">
                          ขาดอีก {4 - playerCount} คน — ไม่มีใครรอคิวอยู่ ให้คนที่พักกลับเข้าคิว
                          เพิ่มผู้เล่นใหม่ หรือยกเลิกไปก่อน
                        </p>
                      )}
                      <div className="court-actions">
                        <button
                          className="btn-primary"
                          onClick={() => onStart(court.id)}
                          disabled={playerCount < 4}
                        >
                          เริ่มเกม
                        </button>
                        <button className="btn-ghost btn-danger" onClick={() => onCancel(court.id)}>
                          ยกเลิก
                        </button>
                      </div>
                    </>
                  ) : (
                    <button className="btn-primary btn-finish" onClick={() => onFinish(court.id)}>
                      จบเกม → คืนคิว
                    </button>
                  )}
                </>
              ) : (
                <>
                  <p className="court-empty-msg">คอร์ตว่าง</p>
                  <button
                    className="btn-primary"
                    onClick={() => onAssign(court.id)}
                    disabled={waitingCount < 4}
                    title={waitingCount < 4 ? 'ต้องมีผู้เล่นรอคิวอย่างน้อย 4 คน' : ''}
                  >
                    จับคู่ลงคอร์ต
                  </button>
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
