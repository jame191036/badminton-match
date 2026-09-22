import { useState } from 'react'
import ThemeToggle from './ThemeToggle'
import PasswordField from './PasswordField'
import { Mail } from 'lucide-react'

const TABS = [
  { id: 'signin', label: 'เข้าสู่ระบบ' },
  { id: 'signup', label: 'สมัครสมาชิก' },
]

export default function Login({ onSignIn, onSignUp, onForgotPassword, theme, onToggleTheme }) {
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  // อีเมลที่ส่งลิงก์ไปแล้ว: { kind: 'verify' | 'reset', email }
  const [sent, setSent] = useState(null)

  function switchMode(next) {
    setMode(next)
    setError('')
    setPassword('')
    setConfirm('')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')

    if (mode === 'signup' && password !== confirm) {
      setError('รหัสผ่านทั้งสองช่องไม่ตรงกัน')
      return
    }

    setLoading(true)
    try {
      if (mode === 'signin') {
        await onSignIn(email, password)
      } else if (mode === 'signup') {
        const signedIn = await onSignUp(email, password)
        if (!signedIn) setSent({ kind: 'verify', email })
      } else {
        await onForgotPassword(email)
        setSent({ kind: 'reset', email })
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const isForgot = mode === 'forgot'
  const isSignup = mode === 'signup'

  return (
    <div className="auth-screen">
      <div className="auth-toggle">
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </div>

      <div className="auth-card">
        <div className="auth-brand">
          <span className="auth-shuttle" aria-hidden="true">🏸</span>
          <span className="eyebrow mono">จัดก๊วนแบด</span>
          <h1 className="display">จับคู่ลงคอร์ต</h1>
          <p className="auth-tagline">
            เพิ่มผู้เล่น ระบบจัดคิวและจับคู่ดับเบิลให้อัตโนมัติ วนเวียนอย่างเป็นธรรม
          </p>
        </div>

        <div className="auth-body">
          {sent ? (
            <div className="auth-sent">
              <div className="auth-sent-icon" aria-hidden="true">
                <Mail strokeWidth={1.8} />
              </div>
              <h2>{sent.kind === 'verify' ? 'ยืนยันอีเมลของคุณ' : 'ส่งลิงก์ตั้งรหัสผ่านแล้ว'}</h2>
              <p className="auth-sent-text">
                {sent.kind === 'verify' ? 'เราส่งลิงก์ยืนยันไปที่' : 'เราส่งลิงก์ตั้งรหัสผ่านใหม่ไปที่'}
                <strong className="auth-email">{sent.email}</strong>
                กดลิงก์ในอีเมลเพื่อ{sent.kind === 'verify' ? 'เปิดใช้งานบัญชี' : 'ตั้งรหัสผ่านใหม่'}
              </p>
              <p className="auth-hint">ไม่เจอในกล่องขาเข้า? ลองดูในโฟลเดอร์จดหมายขยะ</p>
              <div className="auth-sent-actions">
                <button
                  className="btn-ghost"
                  type="button"
                  onClick={() => {
                    setSent(null)
                    switchMode('signin')
                  }}
                >
                  กลับไปหน้าเข้าสู่ระบบ
                </button>
              </div>
            </div>
          ) : (
            <>
              {isForgot ? (
                <>
                  <h2>ลืมรหัสผ่าน</h2>
                  <p className="auth-lead">กรอกอีเมลที่ใช้สมัคร เราจะส่งลิงก์ให้ตั้งรหัสผ่านใหม่</p>
                </>
              ) : (
                <div className="auth-tabs" role="tablist">
                  {TABS.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={mode === tab.id}
                      className={`auth-tab${mode === tab.id ? ' is-active' : ''}`}
                      onClick={() => switchMode(tab.id)}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              )}

              <form className="auth-form" onSubmit={handleSubmit}>
                <label className="auth-field">
                  <span className="auth-label">อีเมล</span>
                  <span className="auth-input-wrap">
                    <Mail className="auth-input-icon" strokeWidth={1.8} aria-hidden="true" />
                    <input
                      type="email"
                      required
                      autoComplete="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </span>
                </label>

                {!isForgot && (
                  <PasswordField
                    label="รหัสผ่าน"
                    value={password}
                    onChange={setPassword}
                    autoComplete={isSignup ? 'new-password' : 'current-password'}
                    minLength={isSignup ? 6 : undefined}
                    hint={isSignup ? 'อย่างน้อย 6 ตัวอักษร' : undefined}
                  />
                )}

                {isSignup && (
                  <PasswordField
                    label="ยืนยันรหัสผ่าน"
                    value={confirm}
                    onChange={setConfirm}
                    autoComplete="new-password"
                  />
                )}

                {mode === 'signin' && (
                  <button type="button" className="auth-link" onClick={() => switchMode('forgot')}>
                    ลืมรหัสผ่าน?
                  </button>
                )}

                {error && <p className="auth-error">{error}</p>}

                <button className="btn-primary auth-submit" type="submit" disabled={loading}>
                  {loading && <span className="auth-spinner" aria-hidden="true" />}
                  {loading
                    ? 'กำลังดำเนินการ...'
                    : isForgot
                      ? 'ส่งลิงก์ตั้งรหัสผ่าน'
                      : isSignup
                        ? 'สมัครสมาชิก'
                        : 'เข้าสู่ระบบ'}
                </button>
              </form>

              {isForgot && (
                <button type="button" className="auth-link auth-link-center" onClick={() => switchMode('signin')}>
                  กลับไปหน้าเข้าสู่ระบบ
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
