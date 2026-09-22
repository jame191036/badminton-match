import { useState } from 'react'
import { SkeletonList } from './Skeleton'
import { useConfirm } from '../hooks/useConfirm'
import { useClubMembers } from '../hooks/useClubMembers'
import { ROLE_LABEL } from '../hooks/useClubs'
import AsyncButton from './AsyncButton'

/** รายชื่อคนที่เข้าถึงก๊วนนี้ได้ และฟอร์มแชร์ (เฉพาะเจ้าของ) */
export default function ClubSharePanel({ clubId, isOwner }) {
  const confirm = useConfirm()
  const { members: rows, loading, error: loadError, share, revoke } = useClubMembers(clubId)
  // error ของปุ่มแชร์/ถอนสิทธิ์ แยกจาก error ตอนโหลดรายชื่อ
  const [error, setError] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('viewer')
  const [busy, setBusy] = useState(false)

  async function handleShare(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await share(email, role)
      setEmail('')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleRevoke(userId) {
    setError('')
    try {
      await revoke(userId)
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <>
      {isOwner && (
        <>
          <p className="panel-hint">
            แชร์ด้วยอีเมลที่เขาใช้สมัครแอปนี้ — ถ้ายังไม่เคยสมัคร ต้องให้เขาสมัครก่อน
          </p>
          <form className="player-form" onSubmit={handleShare}>
            <input
              type="email"
              required
              placeholder="อีเมลของเพื่อน"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="viewer">ดูอย่างเดียว</option>
              <option value="editor">จัดก๊วนได้</option>
            </select>
            <button className="btn-primary" type="submit" disabled={busy || !email.trim()}>
              แชร์
            </button>
          </form>
        </>
      )}

      {(error || loadError) && <p className="auth-error" style={{ marginTop: 12 }}>{error || loadError}</p>}

      {loading ? (
        <SkeletonList count={2} lines={1} />
      ) : (
        <ul className="master-list">
          {rows.map((r) => (
            <li key={r.user_id} className="master-row">
              <div className="master-row-main">
                <span className="master-name">{r.email}</span>
                <span className="badge badge-shared">{ROLE_LABEL[r.role] ?? r.role}</span>
              </div>
              {isOwner && r.role !== 'owner' && (
                <div className="master-row-actions">
                  <AsyncButton
                    className="btn-ghost btn-danger"
                    onClick={async () => {
                      const ok = await confirm({
                        title: 'เอาออกจากก๊วน?',
                        message: `${r.email} จะเข้าดูก๊วนนี้ไม่ได้อีก แต่แชร์กลับเข้ามาใหม่ได้ทุกเมื่อ`,
                        confirmLabel: 'เอาออก',
                        danger: true,
                      })
                      if (ok) handleRevoke(r.user_id)
                    }}
                  >
                    เอาออก
                  </AsyncButton>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
