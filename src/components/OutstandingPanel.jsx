import { useState } from 'react'
import { useClubOutstanding } from '../hooks/useClubOutstanding'
import AsyncButton from './AsyncButton'
import PromptPayQR from './PromptPayQR'
import { SkeletonList } from './Skeleton'
import { formatBaht, outstandingText } from '../utils/billing'
import { shareText } from '../utils/share'
import { thaiDate } from '../utils/date'

const shortDate = (iso) => thaiDate(iso, { weekday: 'short', day: 'numeric', month: 'short' })

/**
 * ยอดค้างจ่ายสะสมของก๊วน — รวมทุกวันที่จบแล้วแต่ยังไม่ได้ติ๊กว่าจ่าย
 * สมาชิกรวมเป็นก้อนเดียวข้ามวัน แขกขาจรแยกเป็นรายวัน (ไม่มีตัวตนข้ามวัน)
 */
export default function OutstandingPanel({ clubId, club, canEdit }) {
  const { groups, loading, error, setPaid } = useClubOutstanding(clubId)
  const [qrFor, setQrFor] = useState(null)
  const [notice, setNotice] = useState('')
  const [actionError, setActionError] = useState('')

  if (loading) return <SkeletonList count={4} lines={1} />
  if (error) return <p className="auth-error">{error}</p>
  if (groups.length === 0) {
    return <p className="empty-text">ไม่มียอดค้างจ่าย ทุกคนจ่ายครบแล้ว 🎉</p>
  }

  const total = groups.reduce((s, g) => s + g.total, 0)

  async function pay(ids) {
    setActionError('')
    try {
      await setPaid(ids, true)
    } catch (err) {
      setActionError(err.message)
    }
  }

  async function share() {
    const result = await shareText(outstandingText({ clubName: club.name, groups, club }))
    setNotice(result === 'copied' ? 'คัดลอกข้อความแล้ว — ไปวางในกลุ่ม LINE ได้เลย' : '')
  }

  return (
    <div className="payment">
      <p className="payment-summary mono">
        ค้าง {groups.length} คน รวม {formatBaht(total)} บาท
      </p>
      <p className="panel-hint">นับเฉพาะวันที่กดจบแล้ว ใช้ยอดที่ล็อกไว้ตอนจบวัน</p>

      <div className="payment-actions">
        <button type="button" className="btn-primary" onClick={share}>
          ส่งยอดค้างให้ทุกคน
        </button>
      </div>
      {notice && <p className="payment-notice">{notice}</p>}
      {actionError && <p className="auth-error">{actionError}</p>}

      <ul className="outstanding-list">
        {groups.map((g) => (
          <li key={g.key} className="outstanding-card">
            <div className="outstanding-head">
              <span className="master-name">{g.name}</span>
              {!g.memberId && <span className="badge badge-shared">แขก</span>}
              <strong className="mono">{formatBaht(g.total)} บาท</strong>
            </div>

            <ul className="outstanding-days">
              {g.days.map((d) => (
                <li key={d.playerId}>
                  <span>{shortDate(d.playDate)}</span>
                  <span className="mono">{formatBaht(d.amount)} บาท</span>
                  {canEdit && (
                    <AsyncButton className="btn-ghost" onClick={() => pay([d.playerId])}>
                      จ่ายแล้ว
                    </AsyncButton>
                  )}
                </li>
              ))}
            </ul>

            <div className="payment-actions">
              {canEdit && g.days.length > 1 && (
                <AsyncButton className="btn-primary" onClick={() => pay(g.days.map((d) => d.playerId))}>
                  จ่ายครบ {formatBaht(g.total)} บาท
                </AsyncButton>
              )}
              {club.promptpayId && (
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => setQrFor(qrFor === g.key ? null : g.key)}
                >
                  QR พร้อมเพย์
                </button>
              )}
            </div>

            {qrFor === g.key && (
              <PromptPayQR
                promptpayId={club.promptpayId}
                promptpayName={club.promptpayName}
                amount={g.total}
                label={g.name}
                onClose={() => setQrFor(null)}
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
