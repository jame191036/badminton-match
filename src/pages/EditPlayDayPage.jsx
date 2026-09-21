import { Link, useNavigate, useParams } from 'react-router-dom'
import { useClubDays } from '../hooks/useClubDays'
import { usePlayDay } from '../hooks/usePlayDay'
import NewPlayDayForm from '../components/NewPlayDayForm'
import { SkeletonHead } from '../components/Skeleton'
import { clock } from '../utils/date'

/**
 * แก้ไขวันเล่นที่จองไว้ — ใช้ฟอร์มตัวเดียวกับหน้าสร้าง ต่างกันที่ส่ง initial
 * เข้าไปแทนการลอกค่าจากวันล่าสุด
 *
 * แก้ได้เฉพาะวันที่ยัง "จองไว้" เท่านั้น (DB บังคับอีกชั้นใน update_play_day)
 * วันที่เริ่มเล่นแล้วแก้ราคาได้ในแท็บหารเงิน ส่วนวันที่จบแล้วยอดถูก freeze
 */
export default function EditPlayDayPage() {
  const { clubId, sessionId } = useParams()
  const navigate = useNavigate()
  const { club, loading: clubLoading, updateDay } = useClubDays(clubId)
  const { day, courts, billing, canEdit, loading: dayLoading, error } = usePlayDay(sessionId)

  if (clubLoading || dayLoading) {
    return (
      <section className="panel">
        <SkeletonHead />
      </section>
    )
  }

  if (error) return <p className="auth-error">{error}</p>

  if (!day || !club || !canEdit || day.status !== 'planned') {
    return (
      <section className="panel">
        <h2>แก้ไขวันเล่นนี้ไม่ได้</h2>
        <p className="empty-text">
          {day && day.status !== 'planned'
            ? 'แก้ได้เฉพาะวันที่ยังไม่เริ่มเล่น — วันที่เริ่มแล้วแก้ราคาได้ในแท็บหารเงิน'
            : 'ไม่พบวันเล่นนี้ หรือคุณไม่มีสิทธิ์แก้ไข'}
        </p>
        <Link to={`/club/${clubId}`} className="btn-ghost">
          กลับไปหน้าก๊วน
        </Link>
      </section>
    )
  }

  return (
    <section className="panel">
      <Link to={`/club/${clubId}/day/${sessionId}`} className="back-link">
        กลับไปหน้าวันเล่น
      </Link>

      <div className="page-head">
        <div>
          <h2>แก้ไขวันเล่น</h2>
          <p className="panel-lead">{club.name}</p>
        </div>
      </div>

      <NewPlayDayForm
        ownerId={club.ownerId}
        submitLabel="บันทึกการแก้ไข"
        initial={{
          playDate: day.playDate,
          startTime: clock(day.startTime),
          endTime: clock(day.endTime),
          venueId: day.venueId ?? '',
          brandId: day.shuttleBrandId ?? '',
          modelId: day.shuttleModelId ?? '',
          hourlyRate: billing.hourlyRate,
          shuttlePrice: billing.shuttlePrice,
          shuttleCount: billing.shuttleCount,
          queueMode: day.queueMode,
          courts: courts.map((c) => ({ name: c.name, hours: String(c.hours ?? '') })),
        }}
        onSubmit={async (payload) => {
          await updateDay(sessionId, payload)
          navigate(`/club/${clubId}/day/${sessionId}`, { replace: true })
        }}
        onCancel={() => navigate(`/club/${clubId}/day/${sessionId}`)}
      />
    </section>
  )
}
