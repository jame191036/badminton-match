import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useClubDays } from '../hooks/useClubDays'
import ClubSharePanel from '../components/ClubSharePanel'
import ClubSettingsPanel from '../components/ClubSettingsPanel'
import { SkeletonHead, SkeletonList } from '../components/Skeleton'
import { todayISO } from '../utils/date'
import { useConfirm } from '../hooks/useConfirm'
import AsyncButton from '../components/AsyncButton'

const STATUS_LABEL = {
  planned: 'จองไว้',
  playing: 'กำลังเล่น',
  done: 'จบแล้ว',
  cancelled: 'ยกเลิก',
}

function formatThaiDate(value) {
  if (!value) return ''
  return new Date(`${value}T00:00:00`).toLocaleDateString('th-TH', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: '2-digit',
  })
}

function formatTimeRange(start, end) {
  if (!start && !end) return null
  const trim = (t) => (t ? String(t).slice(0, 5) : '')
  return `${trim(start)}${end ? `–${trim(end)}` : ''}`
}

export default function ClubPage() {
  const { clubId } = useParams()
  const navigate = useNavigate()
  const {
    club,
    days,
    loading,
    error,
    startDay,
    cancelDay,
    renameClub,
    deleteClub,
  } = useClubDays(clubId)
  // อ่านนาฬิกาครั้งเดียวตอน mount — ไม่อ่านระหว่าง render
  // (เทียบเป็นสตริง YYYY-MM-DD กับ play_date ซึ่งเป็น date ไม่มีเวลา)
  const [today] = useState(todayISO)
  const [tab, setTab] = useState('days')
  const [dayTab, setDayTab] = useState('upcoming')
  const [actionError, setActionError] = useState('')

  const canEdit = club?.role === 'owner' || club?.role === 'editor'

  const byDateAsc = (a, b) => a.playDate.localeCompare(b.playDate)
  const byDateDesc = (a, b) => b.playDate.localeCompare(a.playDate)

  // จองไว้แล้วเลยวันมาแล้วแต่ไม่เคยกดเริ่ม — ต้องแยกออกมา ไม่งั้นค้างอยู่ใน
  // "ที่จะเล่น" ตลอดไป และต้องยังกดเริ่ม/ยกเลิกได้ จึงไม่ยัดไปรวมกับอดีต
  const overdue = days
    .filter((d) => d.status === 'planned' && d.playDate < today)
    .sort(byDateDesc)

  // นัดที่ใกล้ที่สุดอยู่บนสุด (ต่างจากอดีตที่เอาล่าสุดขึ้นก่อน)
  const upcoming = days
    .filter((d) => d.status === 'playing' || (d.status === 'planned' && d.playDate >= today))
    .sort(byDateAsc)

  const past = days
    .filter((d) => d.status === 'done' || d.status === 'cancelled')
    .sort(byDateDesc)

  async function run(fn) {
    setActionError('')
    try {
      await fn()
    } catch (err) {
      setActionError(err.message)
    }
  }

  if (loading) {
    return (
      <section className="panel">
        <SkeletonHead />
        <SkeletonList count={3} />
      </section>
    )
  }
  if (error) return <p className="auth-error">{error}</p>
  if (!club) {
    return (
      <section className="panel">
        <h2>ไม่พบก๊วนนี้</h2>
        <p className="empty-text">อาจถูกลบไปแล้ว หรือคุณไม่มีสิทธิ์เข้าถึง</p>
        <Link to="/" className="btn-ghost">
          กลับไปรายการก๊วน
        </Link>
      </section>
    )
  }

  return (
    <>
      <section className="panel">
        {/* ลิงก์ย้อนกลับอยู่นอก .page-head เพื่อให้ปุ่มด้านขวาเทียบระดับกับ
            ชื่อก๊วน ไม่ใช่เทียบกับบรรทัดแรกสุดของกล่อง */}
        <Link to="/" className="back-link">
          ก๊วนทั้งหมด
        </Link>

        <div className="page-head">
          <div>
            <h2>{club.name}</h2>
            {club.note && <p className="panel-lead">{club.note}</p>}
          </div>

          {/* อยู่นอกแท็บ เห็นได้ทุกแท็บ ไม่ต้องกลับมาแท็บวันเล่นก่อนถึงจะสร้างได้ */}
          {canEdit && (
            <div className="page-head-actions">
              <Link to={`/club/${clubId}/new`} className="btn-primary btn-link">
                + สร้างวันเล่น
              </Link>
            </div>
          )}
        </div>

        <div className="tab-bar" role="tablist">
          {[
            { id: 'days', label: 'วันเล่น' },
            { id: 'share', label: 'คนในก๊วน' },
            { id: 'settings', label: 'ตั้งค่า' },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`tab-btn${tab === t.id ? ' is-active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {actionError && <p className="auth-error">{actionError}</p>}

        {tab === 'share' ? (
          <ClubSharePanel clubId={clubId} isOwner={club.role === 'owner'} />
        ) : tab === 'settings' ? (
          <ClubSettingsPanel
            club={club}
            stats={{
              dayCount: days.length,
              gameCount: days.reduce((sum, d) => sum + d.gameCount, 0),
            }}
            onRename={renameClub}
            onDelete={async () => {
              await deleteClub()
              navigate('/')
            }}
          />
        ) : (
          <>
            {/* แท็บย่อยใช้ทรงแคปซูล ต่างจากแท็บใหญ่ที่เป็นขีดเส้นใต้
                จะได้เห็นว่าอยู่คนละระดับกัน ไม่สับสนว่าเป็นแท็บชุดเดียวกัน */}
            <div className="subtab-bar" role="tablist">
              {[
                { id: 'upcoming', label: 'ที่จะเล่น', count: overdue.length + upcoming.length },
                { id: 'past', label: 'ที่เล่นไปแล้ว', count: past.length },
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={dayTab === t.id}
                  className={`subtab${dayTab === t.id ? ' is-active' : ''}`}
                  onClick={() => setDayTab(t.id)}
                >
                  {t.label}
                  {t.count > 0 && <span className="tab-count mono">{t.count}</span>}
                </button>
              ))}
            </div>

            {dayTab === 'past' ? (
              past.length === 0 ? (
                <p className="empty-text">ยังไม่มีประวัติ — วันที่จบแล้วจะมาโผล่ที่นี่</p>
              ) : (
                <ul className="day-list">
                  {past.map((day) => (
                    <DayRow key={day.id} day={day} clubId={clubId} canEdit={false} />
                  ))}
                </ul>
              )
            ) : (
              <>
                {overdue.length > 0 && (
                  <>
                    <h3 className="section-head">เลยกำหนดแล้ว</h3>
                    <p className="panel-hint">
                      จองไว้แต่ยังไม่ได้กดเริ่ม — ถ้าไปเล่นแล้วกดเริ่มได้เลย ถ้าไม่ได้ไปก็กดยกเลิก
                    </p>
                    <ul className="day-list">
                      {overdue.map((day) => (
                        <DayRow
                          key={day.id}
                          day={day}
                          clubId={clubId}
                          canEdit={canEdit}
                          overdue
                          onStart={() => run(() => startDay(day.id))}
                          onCancel={() => run(() => cancelDay(day.id))}
                        />
                      ))}
                    </ul>
                    <h3 className="section-head">นัดที่จะถึง</h3>
                  </>
                )}

                {upcoming.length === 0 ? (
                  <p className="empty-text">ยังไม่มีนัด — สร้างวันเล่นไว้ล่วงหน้าได้</p>
                ) : (
                  <ul className="day-list">
                    {upcoming.map((day) => (
                      <DayRow
                        key={day.id}
                        day={day}
                        clubId={clubId}
                        canEdit={canEdit}
                        onStart={() => run(() => startDay(day.id))}
                        onCancel={() => run(() => cancelDay(day.id))}
                      />
                    ))}
                  </ul>
                )}
              </>
            )}
          </>
        )}
      </section>
    </>
  )
}

function DayRow({ day, clubId, canEdit, overdue = false, onStart, onCancel }) {
  const confirm = useConfirm()
  const time = formatTimeRange(day.startTime, day.endTime)

  return (
    <li className={`day-row status-${day.status}${overdue ? ' is-overdue' : ''}`}>
      <Link to={`/club/${clubId}/day/${day.id}`} className="day-row-main">
        <div className="day-row-top">
          <span className="day-date">{formatThaiDate(day.playDate)}</span>
          <span className={`badge badge-${overdue ? 'cancelled' : day.status}`}>
            {overdue ? 'เลยกำหนด' : STATUS_LABEL[day.status]}
          </span>
        </div>
        <div className="day-row-meta mono">
          {[day.venueName, time, day.shuttleBrandName].filter(Boolean).join(' · ') || 'ยังไม่ระบุสนาม'}
        </div>
        {day.status === 'done' && (
          <div className="day-row-meta mono">
            {day.playerCount} คน · {day.gameCount} เกม · รวม{' '}
            {day.totalFee.toLocaleString('th-TH')} บาท · คนละ{' '}
            {day.perPerson.toLocaleString('th-TH')} บาท
          </div>
        )}
      </Link>

      {canEdit && day.status === 'planned' && (
        <div className="day-row-actions">
          <AsyncButton className="btn-primary" busyLabel="กำลังเริ่ม..." onClick={onStart}>
            เริ่มวันนี้
          </AsyncButton>
          <AsyncButton
            className="btn-ghost btn-danger"
            onClick={async () => {
              const ok = await confirm({
                title: 'ยกเลิกวันเล่นนี้?',
                message: `${formatThaiDate(day.playDate)} — รายชื่อที่เลือกไว้จะถูกยกเลิกไปด้วย`,
                confirmLabel: 'ยกเลิกวันเล่น',
                cancelLabel: 'ไม่ใช่ตอนนี้',
                danger: true,
              })
              if (ok) await onCancel()
            }}
          >
            ยกเลิก
          </AsyncButton>
        </div>
      )}
    </li>
  )
}
