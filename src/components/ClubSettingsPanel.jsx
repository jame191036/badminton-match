import { useState } from 'react'
import { useConfirm } from '../hooks/useConfirm'

/**
 * ตั้งค่าก๊วน: เปลี่ยนชื่อ และลบก๊วน
 *
 * ลบก๊วนอยู่ตรงนี้ ไม่ใช่ในลิสต์รายการก๊วน เพราะมันลบทุกอย่างที่ตามมาด้วย
 * (วันเล่น ประวัติเกม ยอดเงิน — on delete cascade) ถ้าวางเป็นปุ่มเรียงในลิสต์
 * ข้างๆ ปุ่มลบอย่างอื่นที่ไม่ร้ายแรงเท่ากัน จะกดพลาดง่ายเกินไป
 */
export default function ClubSettingsPanel({ club, stats, onRename, onDelete }) {
  const confirm = useConfirm()
  const [name, setName] = useState(club.name)
  const [note, setNote] = useState(club.note ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const isOwner = club.role === 'owner'
  const dirty = name.trim() !== club.name || (note.trim() || '') !== (club.note ?? '')

  async function handleRename(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await onRename(name, note)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    // ให้พิมพ์ชื่อก๊วนยืนยัน เพราะลบแล้วพาวันเล่นและยอดเงินทั้งหมดไปด้วย
    const ok = await confirm({
      title: `ลบก๊วน "${club.name}" ถาวร?`,
      message: `${stats.dayCount} วันเล่น · ${stats.gameCount} เกม และยอดเงินทั้งหมดของก๊วนนี้จะหายไปด้วย กู้คืนไม่ได้`,
      requireText: club.name,
      confirmLabel: 'ลบก๊วนถาวร',
      danger: true,
    })
    if (!ok) return

    setError('')
    setBusy(true)
    try {
      await onDelete()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  if (!isOwner) {
    return (
      <p className="empty-text">
        เฉพาะเจ้าของก๊วนเท่านั้นที่แก้ไขหรือลบก๊วนได้
      </p>
    )
  }

  return (
    <>
      <form className="day-form" onSubmit={handleRename}>
        <label className="field">
          <span className="field-label">ชื่อก๊วน</span>
          <input type="text" required value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">โน้ต (ไม่บังคับ)</span>
          <input
            type="text"
            placeholder="เช่น ตีทุกวันอังคาร 19:00"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <div className="form-actions">
          <button className="btn-primary" type="submit" disabled={busy || !dirty || !name.trim()}>
            บันทึก
          </button>
        </div>
      </form>

      {error && <p className="auth-error">{error}</p>}

      <div className="danger-zone">
        <h3 className="section-head">ลบก๊วนนี้</h3>
        <p className="panel-hint">
          ลบแล้ว <strong>{stats.dayCount} วันเล่น</strong> · <strong>{stats.gameCount} เกม</strong>{' '}
          และยอดเงินทั้งหมดของก๊วนนี้จะหายไปด้วย กู้คืนไม่ได้
        </p>

        <button className="btn-ghost btn-danger" type="button" disabled={busy} onClick={handleDelete}>
          {busy ? 'กำลังลบ...' : 'ลบก๊วนนี้'}
        </button>
      </div>
    </>
  )
}
