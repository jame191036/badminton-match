import { useState } from 'react'

export default function PasswordField({
  label,
  value,
  onChange,
  autoComplete = 'current-password',
  minLength,
  hint,
}) {
  const [visible, setVisible] = useState(false)

  return (
    <label className="auth-field">
      <span className="auth-label">{label}</span>
      <span className="auth-input-wrap">
        <svg className="auth-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="4" y="10.5" width="16" height="10.5" rx="2.5" />
          <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
        </svg>
        <input
          type={visible ? 'text' : 'password'}
          required
          autoComplete={autoComplete}
          minLength={minLength}
          placeholder="••••••••"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="auth-eye"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
          title={visible ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
        >
          {visible ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 3l18 18" />
              <path d="M10.6 6.3A9.6 9.6 0 0 1 12 6.2c5 0 9 4 9.8 5.8a11 11 0 0 1-3 3.6" />
              <path d="M6.2 8A11.6 11.6 0 0 0 2.2 12c.8 1.8 4.8 5.8 9.8 5.8a9.9 9.9 0 0 0 3.8-.8" />
              <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2.2 12C3 10.2 7 6.2 12 6.2s9 4 9.8 5.8c-.8 1.8-4.8 5.8-9.8 5.8S3 13.8 2.2 12Z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </span>
      {hint && <span className="auth-field-hint">{hint}</span>}
    </label>
  )
}
