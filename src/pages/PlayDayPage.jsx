import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { usePlayDay } from '../hooks/usePlayDay'
import { useBadmintonData } from '../hooks/useBadmintonData'
import PlayerForm from '../components/PlayerForm'
import AddPlayersPicker from '../components/AddPlayersPicker'
import PlayerQueue from '../components/PlayerQueue'
import CourtBoard from '../components/CourtBoard'
import MatchHistory from '../components/MatchHistory'
import SessionStats from '../components/SessionStats'
import BillingPanel from '../components/BillingPanel'
import { SkeletonCourts, SkeletonHead, SkeletonQueue } from '../components/Skeleton'
import { useConfirm } from '../hooks/useConfirm'
import AsyncButton from '../components/AsyncButton'
import { hoursBetween } from '../utils/date'

// count คืน null = ไม่ต้องโชว์ตัวเลขบนแท็บ
// แท็บผู้เล่นโชว์ "จำนวนคนที่รอคิว" ไม่ใช่จำนวนคนทั้งหมด เพราะตอนอยู่แท็บคอร์ต
// สิ่งที่อยากรู้คือยังมีคนพอจับคู่ลงคอร์ตอีกไหม
const DAY_TABS = [
  { id: 'board', label: 'คอร์ต', count: (c) => (c.playing > 0 ? c.playing : null) },
  { id: 'players', label: 'ผู้เล่น', count: (c) => (c.waiting > 0 ? c.waiting : null) },
  { id: 'billing', label: 'หารเงิน', count: () => null },
  { id: 'stats', label: 'สถิติ', count: () => null },
  { id: 'history', label: 'ประวัติ', count: (c) => (c.games > 0 ? c.games : null) },
]

const STATUS_LABEL = {
  planned: 'จองไว้ ยังไม่เริ่ม',
  playing: 'กำลังเล่น',
  done: 'จบแล้ว',
  cancelled: 'ยกเลิกแล้ว',
}

function formatThaiDate(value) {
  if (!value) return ''
  return new Date(`${value}T00:00:00`).toLocaleDateString('th-TH', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

const clock = (t) => (t ? String(t).slice(0, 5) : '')

/** 3 → "3 ชม." / 2.5 → "2 ชม. 30 นาที" */
function formatHoursLabel(hours) {
  const whole = Math.floor(hours)
  const minutes = Math.round((hours - whole) * 60)
  if (whole === 0) return `${minutes} นาที`
  return minutes === 0 ? `${whole} ชม.` : `${whole} ชม. ${minutes} นาที`
}

export default function PlayDayPage() {
  const { clubId, sessionId } = useParams()
  const confirm = useConfirm()
  const {
    day,
    canEdit,
    ownerId,
    billing,
    loading: dayLoading,
    error: dayError,
    saveError,
    clearSaveError,
    updateBilling,
    updateQueueMode,
    startDay,
    closeDay,
  } = usePlayDay(sessionId)

  const isLive = day?.status === 'playing'
  const {
    players,
    courts,
    history,
    summary,
    loading: boardLoading,
    actionError,
    clearActionError,
    addPlayer,
    removePlayer,
    togglePaying,
    toggleRest,
    setAttendance,
    addCourt,
    removeCourt,
    renameCourt,
    updateCourtHours,
    assignCourt,
    startMatch,
    substitutePlayer,
    cancelMatch,
    finishMatch,
  } = useBadmintonData(sessionId, day?.queueMode ?? 'sequential')

  const [headError, setHeadError] = useState('')
  const [tab, setTab] = useState('board')
  const waitingCount = players.filter((p) => p.status === 'waiting').length
  const resting = players.filter((p) => p.status === 'resting')

  const counts = {
    present: players.filter((p) => p.status !== 'absent').length,
    waiting: waitingCount,
    // คอร์ตที่มีเกมอยู่ — บอกบนแท็บว่ายังมีเกมค้างต้องกลับไปจบ
    playing: courts.filter((c) => c.match).length,
    // ใช้ยอดจาก view ไม่ใช่ history.length เพราะ history ดึงมาแค่ 30 แถวล่าสุด
    // ตัวเลขบนแท็บจะได้ไม่ค้างที่ 30 ทั้งที่เล่นไปมากกว่านั้น
    games: summary?.finishedGames ?? 0,
  }

  async function run(fn) {
    setHeadError('')
    try {
      await fn()
    } catch (err) {
      setHeadError(err.message)
    }
  }

  if (dayLoading) {
    return (
      <>
        <section className="panel">
          <SkeletonHead />
        </section>
        <div className="net-divider" />
        <section className="panel">
          <SkeletonQueue />
        </section>
        <div className="net-divider" />
        <section className="panel">
          <SkeletonCourts />
        </section>
      </>
    )
  }
  if (dayError) return <p className="auth-error">{dayError}</p>
  if (!day) {
    return (
      <section className="panel">
        <h2>ไม่พบวันเล่นนี้</h2>
        <Link to="/" className="btn-ghost">
          กลับไปรายการก๊วน
        </Link>
      </section>
    )
  }

  // เช็คแยกทีละช่อง — กรอกค่าสนามแล้วแต่ลืมราคาลูกก็ยังต้องเตือน
  // ('' = กรอกครบ, ไม่ใช่ค่าว่างที่แปลว่า "ไม่มีอะไรขาด" อย่างเดียว)
  const priceMissing = [
    !Number(billing.hourlyRate) && 'ค่าสนาม',
    !Number(billing.shuttlePrice) && 'ราคาลูก',
  ]
    .filter(Boolean)
    .join('และ')

  const timeRange = [clock(day.startTime), clock(day.endTime)].filter(Boolean).join('–')
  const plannedHours = hoursBetween(clock(day.startTime), clock(day.endTime))

  return (
    <>
      <section className="panel">
        <Link to={`/club/${clubId}`} className="back-link">
          กลับไปหน้าก๊วน
        </Link>

        <div className="page-head">
          <div>
            <h2>{formatThaiDate(day.playDate)}</h2>
            <p className="panel-lead">
              {[day.venueName, day.shuttleBrandName].filter(Boolean).join(' · ') || 'ยังไม่ระบุสนาม'}
              {' · '}
              <span className={`badge badge-${day.status}`}>{STATUS_LABEL[day.status]}</span>
            </p>

            {/* เวลาที่นัด กับชั่วโมงที่จองรวมทุกคอร์ต เป็นคนละตัวเลข
                (จอง 2 คอร์ตช่วง 19:00–22:00 = นัด 3 ชม. แต่จ่ายค่าสนาม 6 ชม.) */}
            <p className="day-meta mono">
              {timeRange ? (
                <>
                  {timeRange}
                  {plannedHours != null && ` · ${formatHoursLabel(plannedHours)}`}
                </>
              ) : (
                'ยังไม่ระบุเวลา'
              )}
              {summary?.bookedHours > 0 && (
                <span className="day-meta-sub">
                  จอง {summary.courtCount} คอร์ต รวม {formatHoursLabel(summary.bookedHours)}
                </span>
              )}
            </p>
          </div>

          <div className="page-head-actions">
            {!canEdit && <span className="badge badge-shared">ดูได้อย่างเดียว</span>}
            {canEdit && day.status === 'planned' && (
              <Link to={`/club/${clubId}/day/${sessionId}/edit`} className="btn-ghost btn-link">
                แก้ไข
              </Link>
            )}
            {canEdit && day.status === 'planned' && (
              <AsyncButton
                className="btn-primary"
                busyLabel="กำลังเริ่ม..."
                onClick={() => run(startDay)}
              >
                เริ่มวันเล่น
              </AsyncButton>
            )}
            {canEdit && day.status === 'playing' && (
              <AsyncButton
                className="btn-primary"
                busyLabel="กำลังปิดยอด..."
                onClick={async () => {
                  const ok = await confirm({
                    title: 'จบการเล่นประจำวัน?',
                    message: priceMissing
                      ? `ยังไม่ได้กรอก${priceMissing} — จบแล้วยอดจะถูกล็อกไว้แบบนี้ แก้ทีหลังไม่ได้`
                      : 'ยอดเงินและสถิติของวันนี้จะถูกล็อกไว้ถาวร แก้ทีหลังไม่ได้',
                    confirmLabel: 'จบวันเล่น',
                    cancelLabel: 'ยังไม่จบ',
                    danger: Boolean(priceMissing),
                  })
                  if (ok) await run(closeDay)
                }}
              >
                จบการเล่นประจำวัน
              </AsyncButton>
            )}
          </div>
        </div>

        {/* error ของปุ่มบนแถบหัว (เริ่มวัน/จบวัน) */}
        {headError && <p className="auth-error">{headError}</p>}

        {/* error ของคำสั่งในกระดาน (จัดคอร์ต เพิ่มคน สลับตัว ฯลฯ)
            ลอยค้างไว้จนกว่าจะกดปิด เพราะบางอันเกิดตอนเลื่อนอยู่ล่างจอ */}
        {(actionError || saveError) && (
          <div className="toast-error" role="alert">
            <span>{actionError || saveError}</span>
            <button
              type="button"
              className="btn-icon"
              aria-label="ปิด"
              onClick={() => {
                clearActionError()
                clearSaveError()
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
        )}

        {day.status === 'done' && (
          <div className="frozen-summary">
            <h3 className="section-head">ยอดที่ล็อกไว้</h3>
            <ul className="frozen-grid mono">
              <li>
                <span>ยอดรวม</span>
                <strong>{day.finals.totalFee.toLocaleString('th-TH')} บาท</strong>
              </li>
              <li>
                <span>คนละ</span>
                <strong>{day.finals.perPerson.toLocaleString('th-TH')} บาท</strong>
              </li>
              <li>
                <span>ผู้เล่น</span>
                <strong>{day.finals.playerCount} คน</strong>
              </li>
              <li>
                <span>เกมที่เล่น</span>
                <strong>{day.finals.gameCount} เกม</strong>
              </li>
            </ul>
            <p className="panel-hint">
              ยอดของวันที่จบแล้วถูกแช่ไว้ ไม่เปลี่ยนตามราคาสนามที่แก้ทีหลัง
            </p>
          </div>
        )}
      </section>

      {day.status === 'cancelled' && (
        <section className="panel">
          <p className="empty-text">วันเล่นนี้ถูกยกเลิกไปแล้ว</p>
        </section>
      )}

      {(day.status === 'planned' || day.status === 'playing') && (
        <>
          {/* แท็บติดขอบบนตอนเลื่อน — หน้ายาว ถ้าต้องเลื่อนกลับขึ้นมาสลับจะน่ารำคาญ */}
          <div className="tab-bar" role="tablist">
            {DAY_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                className={`tab-btn${tab === t.id ? ' is-active' : ''}`}
                onClick={() => setTab(t.id)}
              >
                {t.label}
                {t.count(counts) != null && (
                  <span className="tab-count mono">{t.count(counts)}</span>
                )}
              </button>
            ))}
          </div>

          {tab === 'board' && (
            <section className="panel">
              <h2>คอร์ต</h2>
              {!isLive && (
                <p className="panel-hint">
                  กดปุ่ม &ldquo;เริ่มวันเล่น&rdquo; ด้านบนก่อน ถึงจะจัดคนลงคอร์ตได้
                </p>
              )}

              {/* คนที่ติดพักอยู่ ต้องเห็นจากหน้าคอร์ตด้วย ไม่ใช่เฉพาะแท็บผู้เล่น
                  เพราะการสลับตัวจะดันคนออกมาพักโดยอัตโนมัติ ถ้าไม่มีอะไรเตือน
                  เขาจะค้างอยู่ตรงนั้นทั้งวันโดยไม่มีใครสังเกต */}
              {resting.length > 0 && (
                <div className="resting-strip">
                  <span className="resting-strip-label">พักอยู่ {resting.length} คน</span>
                  {resting.map((p) => (
                    <AsyncButton
                      key={p.id}
                      className="resting-chip"
                      disabled={!canEdit}
                      title={canEdit ? `ให้ ${p.name} กลับเข้าคิว` : undefined}
                      onClick={() => toggleRest(p.id)}
                    >
                      {p.name}
                      {canEdit && <span aria-hidden="true">↩</span>}
                    </AsyncButton>
                  ))}
                  {canEdit && <span className="resting-strip-hint">กดชื่อเพื่อให้กลับเข้าคิว</span>}
                </div>
              )}
              {boardLoading ? (
                <SkeletonCourts />
              ) : (
                <CourtBoard
                  courts={courts}
                  readOnly={!canEdit}
                  waitingCount={waitingCount}
                  queueMode={day.queueMode}
                  onChangeQueueMode={updateQueueMode}
                  onAddCourt={addCourt}
                  onRemoveCourt={removeCourt}
                  onRenameCourt={renameCourt}
                  onAssign={assignCourt}
                  onStart={startMatch}
                  onSubstitute={substitutePlayer}
                  onCancel={cancelMatch}
                  onFinish={finishMatch}
                />
              )}
            </section>
          )}

          {tab === 'players' && (
            <section className="panel">
              <h2>ผู้เล่น ({counts.present} คน)</h2>
              {canEdit && (
                <>
                  <PlayerForm onAdd={addPlayer} />
                  <AddPlayersPicker ownerId={ownerId} players={players} onAdd={addPlayer} />
                </>
              )}
              {boardLoading ? (
                <SkeletonQueue />
              ) : (
                <PlayerQueue
                  players={players}
                  readOnly={!canEdit}
                  onToggleRest={toggleRest}
                  onRemove={removePlayer}
                  onSetAttendance={setAttendance}
                />
              )}
            </section>
          )}

          {tab === 'billing' && (
            <section className="panel">
              <h2>หารค่าใช้จ่าย</h2>
              <BillingPanel
                players={players}
                courts={courts}
                readOnly={!canEdit}
                billing={billing}
                onChangeBilling={updateBilling}
                onTogglePaying={togglePaying}
                onChangeCourtHours={updateCourtHours}
              />
            </section>
          )}

          {tab === 'stats' && (
            <section className="panel">
              <h2>สถิติวันนี้</h2>
              <SessionStats players={players} summary={summary} />
            </section>
          )}

          {tab === 'history' && (
            <section className="panel">
              <h2>ประวัติการแข่งขัน</h2>
              <MatchHistory history={history} />
            </section>
          )}
        </>
      )}
    </>
  )
}
