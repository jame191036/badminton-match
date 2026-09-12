import { useState } from 'react'
import ThemeToggle from './ThemeToggle'
import PasswordField from './PasswordField'

export default function ResetPassword({ onSubmit, onCancel, theme, onToggleTheme }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    if (password !== confirm) {
      setError('รหัสผ่านทั้งสองช่องไม่ตรงกัน')
      return
    }
    setLoading(true)
    try {
      await onSubmit(password)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-toggle">
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </div>

      <div className="auth-card">
        <div className="auth-brand">
          <span className="auth-shuttle" aria-hidden="true">🏸</span>
          <span className="eyebrow mono">จัดก๊วนแบด</span>
          <h1 className="display">ตั้งรหัสผ่านใหม่</h1>
          <p className="auth-tagline">ตั้งรหัสผ่านใหม่ให้บัญชีของคุณ แล้วเข้าใช้งานได้ทันที</p>
        </div>

        <div className="auth-body">
          <form className="auth-form" onSubmit={handleSubmit}>
            <PasswordField
              label="รหัสผ่านใหม่"
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              minLength={6}
              hint="อย่างน้อย 6 ตัวอักษร"
            />
            <PasswordField
              label="ยืนยันรหัสผ่านใหม่"
              value={confirm}
              onChange={setConfirm}
              autoComplete="new-password"
            />

            {error && <p className="auth-error">{error}</p>}

            <button className="btn-primary auth-submit" type="submit" disabled={loading}>
              {loading && <span className="auth-spinner" aria-hidden="true" />}
              {loading ? 'กำลังบันทึก...' : 'บันทึกรหัสผ่านใหม่'}
            </button>
          </form>

          <button type="button" className="auth-link auth-link-center" onClick={onCancel}>
            ยกเลิก
          </button>
        </div>
      </div>
    </div>
  )
}
