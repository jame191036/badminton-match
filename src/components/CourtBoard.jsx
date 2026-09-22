import { useEffect, useState } from 'react'
import { QUEUE_MODES, skillLabel, winChance } from '../utils/pairing'
import AsyncButton from './AsyncButton'
import { mmss } from '../utils/date'
import EditableName from './EditableName'

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

function TeamSide({ team, label, onSubstitute }) {
  return (
    <div className="team-side">
      <span className="team-label mono">{label}</span>
      {team.map((p) => (
        <div key={p.id} className="team-player">
          <span>{p.name}</span>
          <span className="team-skill mono">{skillLabel(p.skill)}</span>
          {onSubstitute && (
            <AsyncButton
              className="btn-ghost btn-sub"
              onClick={() => onSubstitute(p.id)}
              title="ยังไม่พร้อม — พักก่อน แล้วให้คนถัดไปในคิวมาแทน"
            >
              พัก
            </AsyncButton>
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

/**
 * โอกาสชนะของสองฝั่งจาก rating — ให้เห็นว่าคู่นี้สูสีแค่ไหนก่อนตี
 * ไม่โชว์เลข rating ของใคร โชว์แค่เปอร์เซ็นต์ (ก๊วนที่ปิดการเห็น rating ก็ยังใช้ได้)
 */
function OddsBadge({ teamA, teamB }) {
  const a = Math.round(winChance(teamA, teamB) * 100)
  return (
    <span className="odds" title="โอกาสชนะที่ระบบคาดไว้ ฝั่ง A – ฝั่ง B">
      {a}–{100 - a}
    </span>
  )
}

const toScore = (v) => (v === '' ? null : Number(v))

/**
 * จบเกม พร้อมช่องแต้มสองฝั่ง — ไม่บังคับกรอก เว้นว่างทั้งคู่ก็จบได้
 * (บางก๊วนไม่จดแต้ม ถ้าบังคับจะกลายเป็นขั้นตอนเกินที่ทุกคนกดข้าม)
 * ถ้ากรอก ต้องครบสองฝั่งและไม่เสมอ — DB ตรวจและตอบเป็นข้อความไทย
 */
function FinishForm({ onFinish }) {
  const [a, setA] = useState('')
  const [b, setB] = useState('')

  return (
    <div className="finish-form">
      <div className="score-inputs">
        <input
          type="number"
          min="0"
          max="99"
          inputMode="numeric"
          placeholder="A"
          aria-label="แต้มฝั่ง A"
          value={a}
          onChange={(e) => setA(e.target.value)}
        />
        <span className="score-dash">–</span>
        <input
          type="number"
          min="0"
          max="99"
          inputMode="numeric"
          placeholder="B"
          aria-label="แต้มฝั่ง B"
          value={b}
          onChange={(e) => setB(e.target.value)}
        />
      </div>
      <AsyncButton
        className="btn-primary btn-finish"
        busyLabel="กำลังจบเกม..."
        onClick={() => onFinish(toScore(a), toScore(b))}
      >
        {a === '' && b === '' ? 'จบเกม → คืนคิว' : 'บันทึกแต้ม + จบเกม'}
      </AsyncButton>
    </div>
  )
}

export default function CourtBoard({
  courts,
  readOnly = false,
  // วันเล่นเริ่มแล้วหรือยัง — ก่อนเริ่ม DB ไม่ยอมให้จับคู่ ปุ่มจึงต้องกดไม่ได้ตั้งแต่แรก
  live,
  waitingCount,
  onAssign,
  onStart,
  onSubstitute,
  onFill,
  onCancel,
  onFinish,
  onAddCourt,
  onRemoveCourt,
  onRenameCourt,
  queueMode,
  onChangeQueueMode,
  forceRest,
  onChangeForceRest,
}) {
  const hasRunning = courts.some((c) => c.match?.status === 'playing')
  const now = useNow(hasRunning)

  return (
    <div className="court-board">
      {/* ไม่มีหัวข้อซ้ำตรงนี้ — หน้าที่เรียกใช้ใส่ <h2> ให้แล้ว
          (ปุ่มเพิ่ม/ลดคอร์ตจึงชิดขวาด้วย justify-content ของกล่องนี้) */}
      <div className="court-board-head">
        <div className="court-controls">
          {!readOnly && (
            <AsyncButton onClick={onRemoveCourt} disabled={courts.length <= 1}>
              − คอร์ต
            </AsyncButton>
          )}
          <span className="mono">{courts.length} คอร์ต</span>
          {!readOnly && <AsyncButton onClick={onAddCourt}>+ คอร์ต</AsyncButton>}
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
              disabled={readOnly}
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

        {/* สวิตช์แยกจากโหมด เพราะใช้ได้กับทั้งสองโหมด
            ปิดแล้วมีคนให้เลือกจับคู่มากขึ้น คู่จึงหลากหลายกว่า แต่คนไม่ได้พัก */}
        <label className="rest-toggle">
          <input
            type="checkbox"
            checked={forceRest}
            disabled={readOnly}
            onChange={(e) => onChangeForceRest(e.target.checked)}
          />
          <span>
            บังคับพัก 1 เกมก่อนลงใหม่
            <span className="rest-toggle-hint">
              {forceRest ? 'คนเพิ่งเล่นจบต้องรออีกเกม' : 'ใครเล่นน้อยสุดได้ลงเลย ไม่ต้องรอ'}
            </span>
          </span>
        </label>
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
                {/* กดดินสอแก้ชื่อได้ — ไปถึงสนามจริงแล้วมักได้คอร์ตคนละเบอร์ */}
                <EditableName
                  label="ชื่อคอร์ต"
                  readOnly={readOnly}
                  fields={[{ key: 'name', value: court.name, placeholder: 'ชื่อคอร์ต', required: true }]}
                  onSave={(v) => onRenameCourt(court.id, v.name)}
                >
                  <span className="court-name display">{court.name}</span>
                </EditableName>
                {match && (
                  <span className={`court-status mono ${isPending ? 'is-pending' : 'is-playing'}`}>
                    {isPending
                      ? 'รอเริ่มเกม'
                      : mmss((now - (match.startedAt ?? now)) / 1000)}
                  </span>
                )}
              </div>

              {match ? (
                <>
                  <div className="court-match">
                    <TeamSide
                      team={match.teamA}
                      label="ฝั่ง A"
                      onSubstitute={
                        isPending && !readOnly ? (pid) => onSubstitute(match.id, pid) : null
                      }
                    />
                    <div className="vs mono">
                      VS
                      {playerCount === 4 && <OddsBadge teamA={match.teamA} teamB={match.teamB} />}
                    </div>
                    <TeamSide
                      team={match.teamB}
                      label="ฝั่ง B"
                      onSubstitute={
                        isPending && !readOnly ? (pid) => onSubstitute(match.id, pid) : null
                      }
                    />
                  </div>

                  {isPending ? (
                    <>
                      {playerCount < 4 && (
                        <p className="court-warn">
                          ขาดอีก {4 - playerCount} คน —{' '}
                          {waitingCount > 0
                            ? 'มีคนรอคิวอยู่แล้ว กด “เติมจากคิว” ได้เลย'
                            : 'ไม่มีใครรอคิวอยู่ ให้คนที่พักกลับเข้าคิว เพิ่มผู้เล่นใหม่ หรือยกเลิกไปก่อน'}
                        </p>
                      )}
                      {!readOnly && (
                        <div className="court-actions">
                          {playerCount < 4 && waitingCount > 0 && (
                            <AsyncButton
                              className="btn-primary"
                              busyLabel="กำลังเติม..."
                              onClick={() => onFill(match.id)}
                            >
                              เติมจากคิว
                            </AsyncButton>
                          )}
                          <AsyncButton
                            className={playerCount < 4 ? 'btn-ghost' : 'btn-primary'}
                            busyLabel="กำลังเริ่ม..."
                            onClick={() => onStart(match.id)}
                            disabled={playerCount < 4}
                          >
                            เริ่มเกม
                          </AsyncButton>
                          <AsyncButton
                            className="btn-ghost btn-danger"
                            onClick={() => onCancel(match.id)}
                          >
                            ยกเลิก
                          </AsyncButton>
                        </div>
                      )}
                    </>
                  ) : (
                    !readOnly && (
                      <FinishForm onFinish={(a, b) => onFinish(match.id, a, b)} />
                    )
                  )}
                </>
              ) : (
                <>
                  <p className="court-empty-msg">คอร์ตว่าง</p>
                  {!readOnly && (
                    <AsyncButton
                      className="btn-primary"
                      busyLabel="กำลังจับคู่..."
                      onClick={() => onAssign(court.id)}
                      disabled={!live || waitingCount < 4}
                      title={
                        !live
                          ? 'กดเริ่มวันเล่นก่อน'
                          : waitingCount < 4
                            ? 'ต้องมีผู้เล่นรอคิวอย่างน้อย 4 คน'
                            : ''
                      }
                    >
                      จับคู่ลงคอร์ต
                    </AsyncButton>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
