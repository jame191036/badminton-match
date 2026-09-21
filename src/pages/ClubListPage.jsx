import { useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { useClubs } from '../hooks/useClubs'
import { SkeletonList } from '../components/Skeleton'
import { thaiDate } from '../utils/date'

const ROLE_LABEL = {
  owner: 'เจ้าของ',
  editor: 'จัดก๊วนได้',
  viewer: 'ดูอย่างเดียว',
}

const formatThaiDate = (v) => thaiDate(v, { day: 'numeric', month: 'short', year: '2-digit' })

export default function ClubListPage() {
  const { user } = useOutletContext()
  const { clubs, loading, error, createClub } = useClubs(user?.id)
  const [name, setName] = useState('')
  const [adding, setAdding] = useState(false)
  const [formError, setFormError] = useState('')
  const [showForm, setShowForm] = useState(false)

  async function handleCreate(e) {
    e.preventDefault()
    setFormError('')
    setAdding(true)
    try {
      await createClub(name)
      setName('')
      setShowForm(false)
    } catch (err) {
      setFormError(err.message)
    } finally {
      setAdding(false)
    }
  }

  return (
    <>
      <section className="panel">
        <div className="page-head">
          <h2>ก๊วนของฉัน</h2>
          {!showForm && (
            <button className="btn-primary" type="button" onClick={() => setShowForm(true)}>
              + สร้างก๊วน
            </button>
          )}
        </div>

        {showForm && (
          <div className="day-form">
            <p className="panel-hint">
              ก๊วนคือกลุ่มคนที่ตีด้วยกันประจำ อยู่ถาวร — ส่วนแต่ละครั้งที่ไปตีจะเป็น
              &ldquo;วันเล่น&rdquo; อยู่ข้างใน
            </p>
            <form className="player-form" onSubmit={handleCreate}>
              <input
                type="text"
                autoFocus
                placeholder="ชื่อก๊วน เช่น ก๊วนวันอังคาร"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
              <button className="btn-primary" type="submit" disabled={adding || !name.trim()}>
                {adding ? 'กำลังสร้าง...' : 'สร้าง'}
              </button>
              <button
                className="btn-ghost"
                type="button"
                onClick={() => {
                  setShowForm(false)
                  setFormError('')
                }}
              >
                ยกเลิก
              </button>
            </form>
            {formError && <p className="auth-error" style={{ marginTop: 12 }}>{formError}</p>}
          </div>
        )}

        {error && <p className="auth-error">{error}</p>}

        {loading ? (
          <SkeletonList count={3} />
        ) : clubs.length === 0 ? (
          <p className="empty-text">ยังไม่มีก๊วน — กด &ldquo;+ สร้างก๊วน&rdquo; ด้านบนเพื่อเริ่ม</p>
        ) : (
          <ul className="club-list">
            {clubs.map((club) => (
              <li key={club.id}>
                <Link to={`/club/${club.id}`} className="club-card">
                  <div className="club-card-main">
                    <span className="club-name">{club.name}</span>
                    <span className="club-meta">
                      {club.playingSessionId ? (
                        <span className="badge badge-live">กำลังเล่นอยู่</span>
                      ) : club.nextPlayDate ? (
                        <span className="badge badge-soon">
                          นัดถัดไป {formatThaiDate(club.nextPlayDate)}
                        </span>
                      ) : null}
                      {!club.isMine && (
                        <span className="badge badge-shared">
                          แชร์มา · {ROLE_LABEL[club.role] ?? club.role}
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="club-card-stats mono">
                    <span>เล่นไปแล้ว {club.doneDays} วัน</span>
                    {club.plannedDays > 0 && <span>· จองไว้ {club.plannedDays} วัน</span>}
                    {club.lastPlayedOn && <span>· ล่าสุด {formatThaiDate(club.lastPlayedOn)}</span>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
