import { useState } from 'react'
import { useConfirm } from '../hooks/useConfirm'
import { isPromptPayId } from '../utils/promptpay'

/**
 * ตั้งค่าก๊วน: เปลี่ยนชื่อ และลบก๊วน
 *
 * ลบก๊วนอยู่ตรงนี้ ไม่ใช่ในลิสต์รายการก๊วน เพราะมันลบทุกอย่างที่ตามมาด้วย
 * (วันเล่น ประวัติเกม ยอดเงิน — on delete cascade) ถ้าวางเป็นปุ่มเรียงในลิสต์
 * ข้างๆ ปุ่มลบอย่างอื่นที่ไม่ร้ายแรงเท่ากัน จะกดพลาดง่ายเกินไป
 */
export default function ClubSettingsPanel({
  club,
  stats,
  onRename,
  onToggleRating,
  onSavePromptPay,
  onDelete,
}) {
  const confirm = useConfirm()
  const [name, setName] = useState(club.name)
  const [note, setNote] = useState(club.note ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [ppId, setPpId] = useState(club.promptpayId ?? '')
  const [ppName, setPpName] = useState(club.promptpayName ?? '')
  const [ppNotice, setPpNotice] = useState('')
  // พิมพ์มีขีดหรือเว้นวรรคได้ (081-234-5678) เก็บเฉพาะตัวเลข
  const ppDigits = ppId.replace(/\D/g, '')
  const ppDirty = ppDigits !== (club.promptpayId ?? '') || ppName.trim() !== (club.promptpayName ?? '')
  const ppValid = ppDigits === '' || isPromptPayId(ppDigits)

  async function handlePromptPay(e) {
    e.preventDefault()
    setError('')
    setPpNotice('')
    setBusy(true)
    try {
      await onSavePromptPay(ppDigits, ppName)
      setPpNotice(ppDigits ? 'บันทึกแล้ว — แท็บเก็บเงินและค้างจ่ายจะมี QR ให้สแกน' : 'ลบเลขพร้อมเพย์แล้ว')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

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
      message: `วันเล่นทั้ง ${stats.dayCount} วัน พร้อมประวัติเกมและยอดเงินทั้งหมดของก๊วนนี้จะหายไปด้วย กู้คืนไม่ได้`,
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

      <form className="day-form" onSubmit={handlePromptPay}>
        <h3 className="section-head">พร้อมเพย์สำหรับเก็บเงิน</h3>
        <p className="panel-hint">
          ใส่แล้วแท็บเก็บเงินกับค้างจ่ายจะสร้าง QR ที่มียอดให้สแกนจ่ายได้เลย · สมาชิกในก๊วนทุกคนเห็นเลขนี้
        </p>
        <label className="field">
          <span className="field-label">เบอร์มือถือ / เลขบัตรประชาชน / e-wallet</span>
          <input
            type="text"
            inputMode="numeric"
            placeholder="เช่น 081-234-5678"
            value={ppId}
            onChange={(e) => setPpId(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field-label">ชื่อบัญชี (ไม่บังคับ)</span>
          <input
            type="text"
            placeholder="ให้คนโอนเห็นว่าโอนถูกคน"
            value={ppName}
            onChange={(e) => setPpName(e.target.value)}
          />
        </label>
        {!ppValid && (
          <p className="auth-error">ต้องเป็นเบอร์มือถือ 10 หลัก เลขบัตร 13 หลัก หรือ e-wallet 15 หลัก</p>
        )}
        {ppNotice && <p className="payment-notice">{ppNotice}</p>}
        <div className="form-actions">
          <button className="btn-primary" type="submit" disabled={busy || !ppDirty || !ppValid}>
            บันทึกพร้อมเพย์
          </button>
        </div>
      </form>

      <label className="guest-toggle rating-toggle">
        <input
          type="checkbox"
          checked={club.showRating}
          disabled={busy}
          onChange={async (e) => {
            setError('')
            try {
              await onToggleRating(e.target.checked)
            } catch (err) {
              setError(err.message)
            }
          }}
        />
        <span>
          ให้ทุกคนในก๊วนเห็นตัวเลข rating ในแท็บอันดับ
          <span className="panel-hint"> (ปิดแล้วยังเรียงอันดับเหมือนเดิม และคนจัดก๊วนยังเห็นเลขอยู่)</span>
        </span>
      </label>

      <div className="danger-zone">
        <h3 className="section-head">ลบก๊วนนี้</h3>
        <p className="panel-hint">
          ลบแล้ว <strong>วันเล่นทั้ง {stats.dayCount} วัน</strong> พร้อมประวัติเกม
          และยอดเงินทั้งหมดของก๊วนนี้จะหายไปด้วย กู้คืนไม่ได้
        </p>

        <button className="btn-ghost btn-danger" type="button" disabled={busy} onClick={handleDelete}>
          {busy ? 'กำลังลบ...' : 'ลบก๊วนนี้'}
        </button>
      </div>
    </>
  )
}
