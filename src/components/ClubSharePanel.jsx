import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { SkeletonList } from './Skeleton'
import { useConfirm } from '../hooks/useConfirm'
import AsyncButton from './AsyncButton'

const ROLE_LABEL = {
  owner: 'เจ้าของ',
  editor: 'จัดก๊วนได้',
  viewer: 'ดูอย่างเดียว',
}

/**
 * รายชื่อคนที่เข้าถึงก๊วนนี้ได้
 * ต้องอ่านผ่าน RPC ไม่ใช่ view เพราะอีเมลอยู่ใน auth.users
 * ซึ่ง role authenticated อ่านตรงๆ ไม่ได้
 */
export default function ClubSharePanel({ clubId, isOwner }) {
  const confirm = useConfirm()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('viewer')
  const [busy, setBusy] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const refetch = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    if (!clubId) return
    let alive = true

    async function load() {
      const { data, error: err } = await supabase.rpc('list_club_members', { p_club_id: clubId })
      if (!alive) return
      if (err) setError(err.message)
      else {
        setRows(data ?? [])
        setError('')
      }
      setLoading(false)
    }

    load()
    return () => {
      alive = false
    }
  }, [clubId, reloadKey])

  async function handleShare(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const { error: err } = await supabase.rpc('grant_club_access', {
        p_club_id: clubId,
        p_email: email,
        p_role: role,
      })
      if (err) throw new Error(err.message)
      setEmail('')
      refetch()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleRevoke(userId) {
    setError('')
    const { error: err } = await supabase.rpc('revoke_club_access', {
      p_club_id: clubId,
      p_user_id: userId,
    })
    if (err) setError(err.message)
    else refetch()
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

      {error && <p className="auth-error" style={{ marginTop: 12 }}>{error}</p>}

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
