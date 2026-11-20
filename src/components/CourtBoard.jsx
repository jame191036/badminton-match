import { useEffect, useRef, useState } from 'react'
import { Play, Square } from 'lucide-react'
import { IGNORES_FORCE_REST, QUEUE_MODES, skillLabel } from '../utils/pairing'
import AsyncButton from './AsyncButton'
import { mmss } from '../utils/date'
import EditableName from './EditableName'
import NameText from './NameText'
import SlideToConfirm from './SlideToConfirm'

// กดค้างนานเท่านี้ถึงจะพัก — นานพอที่แตะผ่าน ๆ ตอนเลื่อนจอไม่ติด สั้นพอที่ไม่ต้องรอ
const HOLD_MS = 600

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

/**
 * ช่องผู้เล่นหนึ่งคน — คอร์ตที่ยังไม่เริ่ม ช่องนี้คือปุ่ม "กดค้างเพื่อพัก"
 * ไม่มีปุ่มพักแยกข้างชื่อ (เดิมแตะทีเดียวก็พักเลย กดพลาดง่ายตอนเลื่อนจอ)
 * กดค้าง = สีค่อย ๆ เติมเต็มช่อง 600ms · ปล่อยก่อน = ยกเลิก
 */
function PlayerTile({ player, side, onBench }) {
  const timer = useRef(null)
  const [holding, setHolding] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => () => clearTimeout(timer.current), [])

  const body = (
    <>
      {onBench && <span className="player-tile-fill" aria-hidden="true" />}
      <span className="player-tile-side mono">{side}</span>
      <span className="player-tile-name">
        <NameText name={player.name} />
      </span>
      <span className={`player-tile-skill skill-${player.skill}`}>
        {busy ? 'กำลังสลับ…' : holding ? 'ค้างไว้…' : skillLabel(player.skill)}
      </span>
    </>
  )

  if (!onBench) return <div className="player-tile">{body}</div>

  const stop = () => {
    clearTimeout(timer.current)
    setHolding(false)
  }
  const start = () => {
    if (busy) return
    clearTimeout(timer.current)
    setHolding(true)
    timer.current = setTimeout(async () => {
      setHolding(false)
      navigator.vibrate?.(18)
      setBusy(true)
      try {
        await onBench()
      } finally {
        setBusy(false)
      }
    }, HOLD_MS)
  }

  return (
    <button
      type="button"
      className="player-tile is-hold"
      data-holding={holding ? '' : undefined}
      aria-busy={busy || undefined}
      aria-label={`${player.name} — กดค้างเพื่อให้พัก แล้วคนถัดไปในคิวมาแทน`}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      // กดค้างบนมือถือต้องไม่เด้งเมนู copy/เลือกข้อความ
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && !e.repeat && start()}
      onKeyUp={(e) => (e.key === 'Enter' || e.key === ' ') && stop()}
    >
      {body}
    </button>
  )
}

// กดจับคู่ตอนนี้จะได้ 4 คนที่เพิ่งเล่นด้วยกันมาทั้งกลุ่ม — บอกสาเหตุกับทางเลี่ยง
// (ดู repeatGroupReason ใน pairing.js) ไม่ได้ห้ามกด แค่ให้รู้ก่อนว่าจะได้อะไร
const REPEAT_GROUP_HINT = {
  rest: 'บังคับพักทำให้รอบนี้ได้ 4 คนกลุ่มเดิมที่เพิ่งเล่นด้วยกัน — ถ้าอยากให้กลุ่มสลับกัน เอาติ๊ก “บังคับพัก” ด้านบนออก',
  wait: 'คนว่างตอนนี้มีแค่ 4 คนที่เพิ่งเล่นด้วยกัน จับตอนนี้จะได้กลุ่มเดิม — ถ้าอยากสลับกลุ่ม รอคอร์ตอื่นจบก่อนแล้วค่อยจับ',
}

export default function CourtBoard({
  courts,
  readOnly = false,
  // วันเล่นเริ่มแล้วหรือยัง — ก่อนเริ่ม DB ไม่ยอมให้จับคู่ ปุ่มจึงต้องกดไม่ได้ตั้งแต่แรก
  live,
  waitingCount,
  // 'rest' | 'wait' | null — จาก useBadmintonData
  repeatGroup = null,
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
  const ignoresRest = IGNORES_FORCE_REST.includes(queueMode)
  const hasRunning = courts.some((c) => c.match?.status === 'playing')
  const now = useNow(hasRunning)
  // ขึ้นคำเตือนแค่คอร์ตว่างคอร์ตแรก — ว่างหลายคอร์ตก็เป็นคำเตือนเดียวกัน ไม่ต้องซ้ำทุกใบ
  const repeatHint =
    !readOnly && live && waitingCount >= 4 ? REPEAT_GROUP_HINT[repeatGroup] : null
  const hintCourtId = repeatHint ? courts.find((c) => !c.match)?.id : null

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

        {/* สวิตช์แยกจากโหมด เพราะสองโหมดแรกใช้ได้ทั้งคู่
            ปิดแล้วมีคนให้เลือกจับคู่มากขึ้น คู่จึงหลากหลายกว่า แต่คนไม่ได้พัก
            โหมดที่ไม่ใช้สวิตช์นี้ให้ปิดช่องติ๊กไว้ ไม่ใช่ปล่อยให้กดแล้วไม่มีผล */}
        <label className="rest-toggle">
          <input
            type="checkbox"
            checked={forceRest}
            disabled={readOnly || ignoresRest}
            onChange={(e) => onChangeForceRest(e.target.checked)}
          />
          <span>
            บังคับพัก 1 เกมก่อนลงใหม่
            <span className="rest-toggle-hint">
              {ignoresRest
                ? 'วิธีจับคู่ที่เลือกไว้ไม่ใช้กติกานี้'
                : forceRest
                  ? 'คนเพิ่งเล่นจบต้องรออีกเกม'
                  : 'ใครเล่นน้อยสุดได้ลงเลย ไม่ต้องรอ'}
            </span>
          </span>
        </label>
      </div>

      <div className="court-grid">
        {courts.map((court) => {
          const match = court.match
          // 'empty' | 'pending' | 'playing' — pending = จับคู่แล้ว ยังไม่กดเริ่ม (สลับตัวได้ ยังไม่จับเวลา)
          const state = !match ? 'empty' : match.status === 'pending' ? 'pending' : 'playing'
          const playerCount = match ? match.teamA.length + match.teamB.length : 0
          const canBench = state === 'pending' && !readOnly

          // ผู้เล่น 2×2: แถวบน A แถวล่าง B · ช่องว่างจากการพักโดยไม่มีใครในคิวมาแทน = "รอคนแทน"
          const tiles = (side, team) => [
            ...team.map((p) => (
              <PlayerTile
                key={p.id}
                player={p}
                side={side}
                onBench={canBench ? () => onSubstitute(match.id, p.id) : null}
              />
            )),
            ...Array.from({ length: Math.max(0, 2 - team.length) }, (_, i) => (
              <div key={`${side}-empty-${i}`} className="player-tile is-empty">
                รอคนแทน
              </div>
            )),
          ]

          return (
            <article key={court.id} className={`court-card is-${state}`}>
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
                <span className="court-head-end">
                  {state === 'playing' && (
                    <span className="court-clock mono">
                      {mmss((now - (match.startedAt ?? now)) / 1000)}
                    </span>
                  )}
                  {state === 'pending' && <span className="court-status">รอเริ่มเกม</span>}
                  {/* ยกเลิกย้อนได้ในตัว (ทุกคนกลับหัวคิว ไม่นับเกม) จึงเป็นปุ่มแตะธรรมดา */}
                  {state === 'pending' && !readOnly && (
                    <AsyncButton className="court-cancel" onClick={() => onCancel(match.id)}>
                      ยกเลิก
                    </AsyncButton>
                  )}
                  {state === 'empty' && <span className="court-status is-empty">ว่าง</span>}
                </span>
              </div>

              {match ? (
                <div className="court-tiles">
                  {tiles('A', match.teamA)}
                  <span className="court-vs mono" aria-hidden="true">
                    VS
                  </span>
                  {tiles('B', match.teamB)}
                </div>
              ) : (
                <p className="court-empty-msg">
                  {readOnly || !live
                    ? 'คอร์ตว่าง'
                    : waitingCount >= 4
                      ? `รอคิว ${waitingCount} คน — จับคู่ได้เลย`
                      : `คนรอคิวไม่ครบ 4 คน (รออยู่ ${waitingCount} คน)`}
                </p>
              )}

              {state === 'empty' && court.id === hintCourtId && (
                <p className="court-warn">{repeatHint}</p>
              )}
              {canBench && playerCount === 4 && (
                <p className="court-hint">กดค้างที่ชื่อเพื่อให้คนนั้นพัก — คนถัดไปในคิวมาแทน</p>
              )}
              {state === 'pending' && playerCount < 4 && waitingCount === 0 && (
                <p className="court-warn">
                  ไม่มีใครรอคิวอยู่ ให้กดชื่อคนที่พักอยู่เข้าคิว เพิ่มผู้เล่นใหม่ หรือยกเลิกไปก่อน
                </p>
              )}

              {/* คำสั่งที่ย้อนไม่ได้และกดบ่อย (เริ่ม/จบเกม) = ปัด · ที่ย้อนได้ (จับคู่/เติม) = แตะ
                  key = สถานะ: เปลี่ยนสถานะแล้วสไลเดอร์ตัวใหม่เริ่มที่ซ้ายสุด */}
              {!readOnly && state === 'playing' && (
                <SlideToConfirm
                  key="finish"
                  label="ปัดเพื่อจบเกม"
                  tone="stop"
                  icon={<Square size={17} fill="currentColor" aria-hidden="true" />}
                  onConfirm={() => onFinish(match.id)}
                />
              )}
              {!readOnly &&
                state === 'pending' &&
                (playerCount === 4 ? (
                  <SlideToConfirm
                    key="start"
                    label="ปัดเพื่อเริ่มเกม"
                    tone="go"
                    icon={<Play size={18} fill="currentColor" aria-hidden="true" />}
                    onConfirm={() => onStart(match.id)}
                  />
                ) : (
                  <AsyncButton
                    className="btn-primary court-button"
                    busyLabel="กำลังเติม..."
                    disabled={waitingCount === 0}
                    onClick={() => onFill(match.id)}
                  >
                    {waitingCount > 0
                      ? `เติมจากคิว (ขาด ${4 - playerCount} คน)`
                      : `ขาดอีก ${4 - playerCount} คน — ไม่มีใครรอ`}
                  </AsyncButton>
                ))}
              {!readOnly && state === 'empty' && (
                <AsyncButton
                  className="btn-primary court-button"
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
            </article>
          )
        })}
      </div>
    </div>
  )
}
