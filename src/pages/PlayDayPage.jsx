import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { usePlayDay } from '../hooks/usePlayDay'
import { useBadmintonData } from '../hooks/useBadmintonData'
import PlayerForm from '../components/PlayerForm'
import PlayerQueue from '../components/PlayerQueue'
import CourtBoard from '../components/CourtBoard'
import MatchHistory from '../components/MatchHistory'
import SessionStats from '../components/SessionStats'
import BillingPanel from '../components/BillingPanel'
import { SkeletonCourts, SkeletonHead, SkeletonQueue } from '../components/Skeleton'
import { useConfirm } from '../hooks/useConfirm'

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

export default function PlayDayPage() {
  const { clubId, sessionId } = useParams()
  const confirm = useConfirm()
  const {
    day,
    canEdit,
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
    updateCourtHours,
    assignCourt,
    startMatch,
    substitutePlayer,
    cancelMatch,
    finishMatch,
  } = useBadmintonData(sessionId, day?.queueMode ?? 'sequential')

  const [headError, setHeadError] = useState('')
  const waitingCount = players.filter((p) => p.status === 'waiting').length

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

  return (
    <>
      <section className="panel">
        <div className="page-head">
          <div>
            <Link to={`/club/${clubId}`} className="back-link">
              ← กลับไปหน้าก๊วน
            </Link>
            <h2>{formatThaiDate(day.playDate)}</h2>
            <p className="panel-lead">
              {[day.venueName, day.shuttleBrandName].filter(Boolean).join(' · ') || 'ยังไม่ระบุสนาม'}
              {' · '}
              <span className={`badge badge-${day.status}`}>{STATUS_LABEL[day.status]}</span>
            </p>
          </div>

          <div className="page-head-actions">
            {!canEdit && <span className="badge badge-shared">ดูได้อย่างเดียว</span>}
            {canEdit && day.status === 'planned' && (
              <button className="btn-primary" type="button" onClick={() => run(startDay)}>
                เริ่มวันเล่น
              </button>
            )}
            {canEdit && day.status === 'playing' && (
              <button
                className="btn-primary"
                type="button"
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
                  if (ok) run(closeDay)
                }}
              >
                จบการเล่นประจำวัน
              </button>
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
          <div className="net-divider" />

          <section className="panel">
            <h2>ผู้เล่น ({players.filter((p) => p.status !== 'absent').length} คน)</h2>
            {canEdit && <PlayerForm onAdd={addPlayer} />}
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

          <div className="net-divider" />

          <section className="panel">
            <h2>คอร์ต</h2>
            {!isLive && (
              <p className="panel-hint">กดปุ่ม &ldquo;เริ่มวันเล่น&rdquo; ด้านบนก่อน ถึงจะจัดคนลงคอร์ตได้</p>
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
                onAssign={assignCourt}
                onStart={startMatch}
                onSubstitute={substitutePlayer}
                onCancel={cancelMatch}
                onFinish={finishMatch}
              />
            )}
          </section>

          <div className="net-divider" />

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
        </>
      )}
    </>
  )
}
