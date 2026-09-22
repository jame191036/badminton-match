import { useState } from 'react'
import AsyncButton from './AsyncButton'
import PromptPayQR from './PromptPayQR'
import { dayPaymentText, formatBaht } from '../utils/billing'
import { shareText } from '../utils/share'
import { thaiDate } from '../utils/date'

const shortDate = (iso) => thaiDate(iso, { day: 'numeric', month: 'short' })

/**
 * แท็บเก็บเงินของวันเล่น — ใครจ่ายแล้ว ใครยังไม่จ่าย + ส่งยอดเข้ากลุ่ม + QR พร้อมเพย์
 *
 * payers    คนที่ต้องจ่ายวันนี้ (มา และร่วมจ่าย)
 * perPerson ยอดต่อคน: วันที่จบแล้วคือยอดที่ freeze ไว้, วันที่ยังเล่นคือยอดสด (live)
 * prior     Map memberId -> { total, days } ยอดค้างจากวันก่อน ๆ ของก๊วนนี้ (ไม่รวมวันนี้)
 *           คนเก็บเงินจะได้รับทีเดียวครบ ไม่ต้องไปเปิดดูอีกแท็บ
 */
export default function PaymentPanel({
  payers,
  perPerson,
  total,
  live,
  readOnly,
  prior,
  club,
  dateLabel,
  onSetPaid,
}) {
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [showQr, setShowQr] = useState(false)

  if (payers.length === 0) {
    return <p className="empty-state">ยังไม่มีคนที่ต้องจ่าย</p>
  }

  const paidCount = payers.filter((p) => p.paidAt).length
  const hasPromptPay = Boolean(club?.promptpayId)

  async function setPaid(ids, paid) {
    setError('')
    try {
      await onSetPaid(ids, paid)
    } catch (err) {
      setError(err.message)
    }
  }

  async function share() {
    const text = dayPaymentText({ clubName: club?.name ?? '', dateLabel, total, perPerson, payers, live, club })
    const result = await shareText(text)
    if (result === 'copied') setNotice('คัดลอกข้อความแล้ว — ไปวางในกลุ่ม LINE ได้เลย')
    else if (result === 'shared') setNotice('')
  }

  return (
    <div className="payment">
      <p className="payment-summary mono">
        จ่ายแล้ว {paidCount}/{payers.length} คน · ได้ {formatBaht(paidCount * perPerson)} จาก{' '}
        {formatBaht(total)} บาท
      </p>
      {live && (
        <p className="panel-hint">
          ยังไม่ได้กดจบวัน ยอดคนละ {formatBaht(perPerson)} บาทยังเปลี่ยนได้ถ้าแก้ราคาหรือจำนวนคน
        </p>
      )}

      <div className="payment-actions">
        <button type="button" className="btn-primary" onClick={share}>
          ส่งยอดให้ทุกคน
        </button>
        {hasPromptPay && perPerson > 0 && (
          <button type="button" className="btn-ghost" onClick={() => setShowQr((v) => !v)}>
            QR พร้อมเพย์ คนละ {formatBaht(perPerson)}
          </button>
        )}
      </div>
      {!hasPromptPay && (
        <p className="panel-hint">ใส่เลขพร้อมเพย์ในแท็บตั้งค่าของก๊วน แล้วจะสร้าง QR ให้สแกนจ่ายได้</p>
      )}
      {notice && <p className="payment-notice">{notice}</p>}
      {error && <p className="auth-error">{error}</p>}

      {showQr && (
        <PromptPayQR
          promptpayId={club.promptpayId}
          promptpayName={club.promptpayName}
          amount={perPerson}
          label="คนละ"
          onClose={() => setShowQr(false)}
        />
      )}

      <ul className="billing-list">
        {payers.map((p) => {
          const owed = p.memberId ? prior.get(p.memberId) : null
          return (
            <li key={p.id} className={`billing-item payment-item${p.paidAt ? ' is-paid' : ''}`}>
              <label className="billing-checkbox">
                <input
                  type="checkbox"
                  checked={Boolean(p.paidAt)}
                  disabled={readOnly}
                  onChange={(e) => setPaid([p.id], e.target.checked)}
                />
                <span>{p.name}</span>
              </label>
              <span className="billing-amount mono">
                {p.paidAt ? 'จ่ายแล้ว' : `${formatBaht(perPerson)} บาท`}
              </span>
              {owed && (
                <span className="payment-owed">
                  ค้างจากวันก่อน {formatBaht(owed.total)} บาท (
                  {owed.days.map((d) => shortDate(d.playDate)).join(', ')})
                  {!readOnly && (
                    <AsyncButton
                      className="btn-ghost"
                      onClick={() =>
                        setPaid([...(p.paidAt ? [] : [p.id]), ...owed.days.map((d) => d.playerId)], true)
                      }
                    >
                      รับรวม {formatBaht(owed.total + (p.paidAt ? 0 : perPerson))} บาท
                    </AsyncButton>
                  )}
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
