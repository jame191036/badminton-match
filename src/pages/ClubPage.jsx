import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useClubDays } from '../hooks/useClubDays'
import { usePastDays } from '../hooks/usePastDays'
import ClubSharePanel from '../components/ClubSharePanel'
import ClubSettingsPanel from '../components/ClubSettingsPanel'
import { SkeletonHead, SkeletonList } from '../components/Skeleton'
import { clock, thaiDate, todayISO } from '../utils/date'
import { useConfirm } from '../hooks/useConfirm'
import AsyncButton from '../components/AsyncButton'

const STATUS_LABEL = {
  planned: 'จองไว้',
  playing: 'กำลังเล่น',
  done: 'จบแล้ว',
  cancelled: 'ยกเลิก',
}

const formatThaiDate = (v) =>
  thaiDate(v, { weekday: 'short', day: 'numeric', month: 'short', year: '2-digit' })

function formatTimeRange(start, end) {
  if (!start && !end) return null
  return `${clock(start)}${end ? `–${clock(end)}` : ''}`
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
            // total_days นับทุกสถานะ รวม playing กับ cancelled ที่ cascade ก็ลบไปด้วย
            stats={{ dayCount: club.totalDays }}
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
                // นับจาก v_my_clubs เพราะประวัติโหลดทีละหน้า และต้องรวมวันที่ยกเลิก
                // ให้ตรงกับแถวในตาราง ซึ่งแสดงทั้ง done และ cancelled
                { id: 'past', label: 'ที่เล่นไปแล้ว', count: club.doneDays + club.cancelledDays },
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
              <PastDaysTable clubId={clubId} />
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
                          canStart
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
                        canStart={day.playDate <= today}
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

/**
 * ประวัติวันเล่น — เป็นตารางเพราะทุกแถวมีคอลัมน์เดียวกันและคนมาดูเพื่อ
 * "เทียบ" (วันไหนจ่ายเยอะ วันไหนคนเยอะ) ซึ่งการ์ดเรียงกันเทียบยาก
 */
function PastDaysTable({ clubId }) {
  const { days, loading, error, page, pageCount, total, goTo } = usePastDays(clubId)

  if (loading && days.length === 0) return <SkeletonList count={5} lines={1} />
  if (error) return <p className="auth-error">{error}</p>
  if (total === 0) {
    return <p className="empty-text">ยังไม่มีประวัติ — วันที่จบแล้วจะมาโผล่ที่นี่</p>
  }

  return (
    <>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>วันที่</th>
              <th>สนาม</th>
              <th>เวลา</th>
              <th className="is-num">คน</th>
              <th className="is-num">เกม</th>
              <th className="is-num">ยอดรวม</th>
              <th className="is-num">คนละ</th>
            </tr>
          </thead>
          <tbody>
            {days.map((day) => (
              <tr key={day.id} className={day.status === 'cancelled' ? 'is-cancelled' : ''}>
                <td>
                  <Link to={`/club/${clubId}/day/${day.id}`} className="table-link">
                    {formatThaiDate(day.playDate)}
                  </Link>
                  {day.status === 'cancelled' && <span className="badge badge-cancelled">ยกเลิก</span>}
                </td>
                <td>{day.venueName ?? '—'}</td>
                <td className="mono">{formatTimeRange(day.startTime, day.endTime) ?? '—'}</td>
                <td className="is-num mono">{day.status === 'cancelled' ? '—' : day.playerCount}</td>
                <td className="is-num mono">{day.status === 'cancelled' ? '—' : day.gameCount}</td>
                <td className="is-num mono">
                  {day.status === 'cancelled' ? '—' : day.totalFee.toLocaleString('th-TH')}
                </td>
                <td className="is-num mono">
                  {day.status === 'cancelled' ? '—' : day.perPerson.toLocaleString('th-TH')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <div className="pager">
          <button
            type="button"
            className="btn-ghost"
            disabled={page === 0 || loading}
            onClick={() => goTo(page - 1)}
          >
            ← ก่อนหน้า
          </button>
          <span className="pager-info mono">
            หน้า {page + 1} / {pageCount} · ทั้งหมด {total} วัน
          </span>
          <button
            type="button"
            className="btn-ghost"
            disabled={page >= pageCount - 1 || loading}
            onClick={() => goTo(page + 1)}
          >
            ถัดไป →
          </button>
        </div>
      )}
    </>
  )
}

// canStart = ถึงวันแล้ว — วันในอนาคตไม่มีปุ่ม "เริ่มวันนี้" (ยังเข้าไปเริ่มจากหน้าวันเล่นได้)
function DayRow({ day, clubId, canEdit, canStart = false, overdue = false, onStart, onCancel }) {
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
          {canStart && (
            <AsyncButton className="btn-primary" busyLabel="กำลังเริ่ม..." onClick={onStart}>
              เริ่มวันนี้
            </AsyncButton>
          )}
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
