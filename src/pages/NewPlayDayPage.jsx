import { Link, useNavigate, useParams } from 'react-router-dom'
import { useClubDays } from '../hooks/useClubDays'
import NewPlayDayForm from '../components/NewPlayDayForm'
import { SkeletonHead } from '../components/Skeleton'

/**
 * หน้าสร้างวันเล่น แยกออกมาเป็นหน้าของตัวเอง
 *
 * เดิมฟอร์มนี้แทรกอยู่เหนือรายการวันเล่นในหน้าก๊วน ทำให้แยกไม่ออกว่า
 * ตรงไหนคือฟอร์มที่กำลังกรอก ตรงไหนคือรายการที่มีอยู่แล้ว
 */
export default function NewPlayDayPage() {
  const { clubId } = useParams()
  const navigate = useNavigate()
  const { club, loading, error, loadDefaults, createDay } = useClubDays(clubId)

  const canEdit = club?.role === 'owner' || club?.role === 'editor'

  async function handleCreate(payload) {
    const sessionId = await createDay(payload)
    // เข้าหน้าวันเล่นที่เพิ่งสร้างเลย ไม่ต้องกลับไปหาในรายการ
    navigate(`/club/${clubId}/day/${sessionId}`, { replace: true })
  }

  if (loading) {
    return (
      <section className="panel">
        <SkeletonHead />
      </section>
    )
  }

  if (error) return <p className="auth-error">{error}</p>

  if (!club || !canEdit) {
    return (
      <section className="panel">
        <h2>สร้างวันเล่นไม่ได้</h2>
        <p className="empty-text">
          {club ? 'คุณไม่มีสิทธิ์จัดวันเล่นของก๊วนนี้' : 'ไม่พบก๊วนนี้ หรือคุณไม่มีสิทธิ์เข้าถึง'}
        </p>
        <Link to={`/club/${clubId}`} className="btn-ghost">
          กลับไปหน้าก๊วน
        </Link>
      </section>
    )
  }

  return (
    <section className="panel">
      <Link to={`/club/${clubId}`} className="back-link">
        กลับไปหน้าก๊วน
      </Link>

      <div className="page-head">
        <div>
          <h2>สร้างวันเล่นใหม่</h2>
          <p className="panel-lead">{club.name}</p>
        </div>
      </div>

      <NewPlayDayForm
        ownerId={club.ownerId}
        loadDefaults={loadDefaults}
        onSubmit={handleCreate}
        onCancel={() => navigate(`/club/${clubId}`)}
      />
    </section>
  )
}
