import { useState } from 'react'

export default function SessionBar({ name, onRename, onClose }) {
  const [draft, setDraft] = useState(name)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)

  if (!editing && draft !== name && !busy) setDraft(name)

  async function handleClose() {
    setError('')
    setBusy(true)
    try {
      await onClose()
    } catch (err) {
      // ส่วนใหญ่คือ "ยังมีเกมค้างอยู่ในคอร์ต" ที่ RPC โยนกลับมา
      setError(err.message)
      setConfirming(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="session-bar">
      <div className="session-bar-main">
        <span className="session-bar-label">ก๊วนปัจจุบัน</span>
        <input
          className="session-name-input"
          value={draft}
          aria-label="ชื่อก๊วน"
          onFocus={() => setEditing(true)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            setEditing(false)
            if (draft.trim() && draft !== name) onRename(draft.trim())
          }}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      </div>

      {confirming ? (
        <div className="session-bar-confirm">
          <span>ปิดก๊วนนี้? ยอดเงินและสถิติจะถูกเก็บไว้เป็นประวัติ แก้ทีหลังไม่ได้</span>
          <button className="btn-primary" onClick={handleClose} disabled={busy}>
            {busy ? 'กำลังปิด...' : 'ยืนยันปิดก๊วน'}
          </button>
          <button className="btn-ghost" onClick={() => setConfirming(false)} disabled={busy}>
            ยกเลิก
          </button>
        </div>
      ) : (
        <button className="btn-ghost" onClick={() => setConfirming(true)}>
          ปิดก๊วน
        </button>
      )}

      {error && <p className="session-bar-error">{error}</p>}
    </div>
  )
}
