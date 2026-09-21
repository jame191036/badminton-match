import { useState } from 'react'
import { Pencil } from 'lucide-react'

/**
 * ชื่อในลิสต์ที่กดแก้ไขได้ — ใช้ร่วมกันทั้งผู้เล่น สนาม และยี่ห้อลูกแบด
 *
 * ไม่ทำเป็น input ที่แก้ได้ตลอดเวลา เพราะลิสต์จะดูรกและกดโดนง่าย
 * กดปุ่มดินสอก่อนถึงเปลี่ยนเป็นช่องกรอก (Enter = บันทึก, Esc = ยกเลิก)
 *
 * รับได้หลายช่องในชุดเดียว (ยี่ห้อลูกแบดมีทั้ง "ยี่ห้อ" และ "รุ่น")
 *   fields: [{ key, value, placeholder, required }]
 *   onSave: (values) => Promise   // values = { [key]: string }
 */
export default function EditableName({ fields, onSave, label = 'ชื่อ', readOnly = false, children }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const original = Object.fromEntries(fields.map((f) => [f.key, f.value ?? '']))

  function start() {
    setDraft(original)
    setError('')
    setEditing(true)
  }

  function cancel() {
    setEditing(false)
    setError('')
  }

  async function save() {
    const values = Object.fromEntries(fields.map((f) => [f.key, (draft[f.key] ?? '').trim()]))

    const missing = fields.find((f) => f.required && !values[f.key])
    if (missing) {
      setError(`ต้องใส่${missing.placeholder}`)
      return
    }

    const unchanged = fields.every((f) => values[f.key] === (f.value ?? '').trim())
    if (unchanged) {
      cancel()
      return
    }

    setBusy(true)
    try {
      // ช่องที่ปล่อยว่าง (เช่นไม่ระบุรุ่น) เก็บเป็น null ไม่ใช่สตริงว่าง
      await onSave(
        Object.fromEntries(fields.map((f) => [f.key, values[f.key] || (f.required ? '' : null)])),
      )
      setEditing(false)
      setError('')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  // ไม่มีสิทธิ์แก้ (เช่นถูกเชิญมาเป็นผู้ชม) — แสดงชื่อเฉยๆ ไม่ต้องมีปุ่มดินสอ
  if (readOnly) return children

  if (!editing) {
    return (
      <>
        {children}
        <button
          className="btn-icon"
          type="button"
          onClick={start}
          aria-label={`แก้ไข${label}`}
          title={`แก้ไข${label}`}
        >
          <Pencil strokeWidth={1.8} aria-hidden="true" />
        </button>
      </>
    )
  }

  return (
    <span className="name-edit">
      {fields.map((f, i) => (
        <input
          key={f.key}
          type="text"
          value={draft[f.key] ?? ''}
          placeholder={f.placeholder}
          autoFocus={i === 0}
          disabled={busy}
          onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              save()
            }
            if (e.key === 'Escape') cancel()
          }}
        />
      ))}
      <button className="btn-ghost" type="button" onClick={save} disabled={busy}>
        บันทึก
      </button>
      <button className="btn-ghost" type="button" onClick={cancel} disabled={busy}>
        ยกเลิก
      </button>
      {error && <span className="name-edit-error">{error}</span>}
    </span>
  )
}
