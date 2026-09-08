import { useState } from 'react'

export default function Login({ onSignIn }) {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await onSignIn(email)
      setSent(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="app-shell">
      <div className="panel" style={{ marginTop: 60, maxWidth: 380, marginInline: 'auto' }}>
        {sent ? (
          <>
            <h2>เช็คอีเมลของคุณ</h2>
            <p>เราส่งลิงก์เข้าสู่ระบบไปที่ {email} แล้ว กดลิงก์ในอีเมลเพื่อเข้าใช้งาน</p>
          </>
        ) : (
          <>
            <h2>เข้าสู่ระบบ</h2>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
              <input
                type="email"
                required
                placeholder="อีเมลของคุณ"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <button className="btn-primary" type="submit" disabled={loading}>
                {loading ? 'กำลังส่งลิงก์...' : 'ส่งลิงก์เข้าสู่ระบบ'}
              </button>
              {error && <p style={{ color: 'var(--coral)' }}>{error}</p>}
            </form>
          </>
        )}
      </div>
    </div>
  )
}
