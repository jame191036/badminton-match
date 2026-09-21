import { useState } from 'react'
import { Eye, EyeOff, Lock } from 'lucide-react'

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
        <Lock className="auth-input-icon" strokeWidth={1.8} aria-hidden="true" />
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
            <EyeOff strokeWidth={1.8} aria-hidden="true" />
          ) : (
            <Eye strokeWidth={1.8} aria-hidden="true" />
          )}
        </button>
      </span>
      {hint && <span className="auth-field-hint">{hint}</span>}
    </label>
  )
}
