import { useState } from 'react'
import { SPLIT_MODES, computeBilling, isPayer, toNumber } from '../utils/billing'
import NameText from './NameText'

function formatBaht(n) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatHours(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

// ชั่วโมงของคอร์ตเก็บอยู่ใน DB และมี realtime คอยอัปเดต ถ้าผูก input
// ตรงกับค่าจาก server ตัวเลขจะกระตุกระหว่างพิมพ์ (เช่นพิมพ์ "1." ค้างไม่ได้)
// เลยถือ draft ไว้ในเครื่องระหว่างพิมพ์ แล้วค่อย commit ตอนออกจากช่อง
function CourtHoursInput({ court, onCommit, readOnly }) {
  const [draft, setDraft] = useState(() => (court.hours ? String(court.hours) : ''))
  const [editing, setEditing] = useState(false)
  const [lastFromServer, setLastFromServer] = useState(court.hours)

  // ปรับ state ระหว่าง render (ไม่ใช่ใน effect) ตามแนวทางของ React
  // สำหรับ state ที่ต้องรีเซ็ตเมื่อ props เปลี่ยน
  if (!editing && court.hours !== lastFromServer) {
    setLastFromServer(court.hours)
    setDraft(court.hours ? String(court.hours) : '')
  }

  function commit() {
    setEditing(false)
    const next = toNumber(draft)
    if (next !== toNumber(court.hours)) onCommit(court.id, next)
  }

  return (
    <input
      type="number"
      min="0"
      step="0.5"
      inputMode="decimal"
      placeholder="0"
      aria-label={`ชั่วโมงที่จองของ${court.name}`}
      disabled={readOnly}
      value={draft}
      onFocus={() => setEditing(true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    />
  )
}

export default function BillingPanel({
  players,
  courts,
  readOnly = false,
  billing,
  splitMode = 'equal',
  onChangeBilling,
  onChangeSplitMode,
  onTogglePaying,
  onChangeCourtHours,
}) {
  // สูตรอยู่ที่ utils/billing.js ที่เดียว (รายงาน PDF/รูปใช้ตัวเดียวกัน) — ยอดรวมต้องตรงกับ v_billing_summary
  const { hourlyRate, shuttleCount, totalHours, courtTotal, shuttleTotal, total, payerCount, perPerson, perGame, payerGames, shares } =
    computeBilling({ players, courts, billing, splitMode })
  const byGames = splitMode === 'games'

  // คนที่กด "ไม่มา" ไม่ถูกนับทั้งตัวหารและรายชื่อ
  const present = players.filter((p) => p.status !== 'absent')

  if (present.length === 0) {
    return <p className="empty-state">ยังไม่มีคนที่มาเล่น ถึงจะหารค่าใช้จ่ายได้</p>
  }

  return (
    <div className="billing">
      <h3 className="billing-group-title">ค่าสนาม</h3>
      <div className="billing-inputs">
        <label className="billing-field">
          <span>ราคาต่อชั่วโมง (บาท)</span>
          <input
            type="number"
            min="0"
            inputMode="decimal"
            placeholder="0"
            value={billing.hourlyRate}
            disabled={readOnly}
            onChange={(e) => onChangeBilling({ ...billing, hourlyRate: e.target.value })}
          />
        </label>
      </div>

      {courts.length === 0 ? (
        <p className="empty-state small">ยังไม่มีคอร์ต — เพิ่มคอร์ตก่อนถึงจะคิดค่าสนามได้</p>
      ) : (
        <ul className="court-hours-list">
          {courts.map((court) => (
            <li key={court.id} className="court-hours-item">
              <span className="court-hours-name">{court.name}</span>
              <CourtHoursInput court={court} onCommit={onChangeCourtHours} readOnly={readOnly} />
              <span className="court-hours-unit">ชม.</span>
              <span className="billing-amount mono">
                {formatBaht(toNumber(court.hours) * hourlyRate)} บาท
              </span>
            </li>
          ))}
        </ul>
      )}

      <h3 className="billing-group-title">ค่าลูกแบด</h3>
      <div className="billing-inputs">
        <label className="billing-field">
          <span>จำนวนลูกที่ใช้</span>
          <input
            type="number"
            min="0"
            step="1"
            inputMode="numeric"
            placeholder="0"
            value={billing.shuttleCount}
            disabled={readOnly}
            onChange={(e) => onChangeBilling({ ...billing, shuttleCount: e.target.value })}
          />
        </label>
        <label className="billing-field">
          <span>ราคาต่อลูก (บาท)</span>
          <input
            type="number"
            min="0"
            inputMode="decimal"
            placeholder="0"
            value={billing.shuttlePrice}
            disabled={readOnly}
            onChange={(e) => onChangeBilling({ ...billing, shuttlePrice: e.target.value })}
          />
        </label>
      </div>

      {/* วิธีหาร — ปุ่มเรียงแบบเดียวกับ "วิธีจับคู่" ในแท็บคอร์ต · เปลี่ยนได้จนกว่าจะจบวัน */}
      <h3 className="billing-group-title">วิธีหาร</h3>
      <div className="queue-mode billing-split">
        <div className="queue-mode-options" role="group" aria-label="วิธีหาร">
          {SPLIT_MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              className={`queue-mode-btn ${splitMode === m.value ? 'active' : ''}`}
              aria-pressed={splitMode === m.value}
              disabled={readOnly}
              onClick={() => onChangeSplitMode(m.value)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <span className="queue-mode-hint">{SPLIT_MODES.find((m) => m.value === splitMode)?.hint}</span>
      </div>

      <div className="billing-summary">
        <div className="billing-summary-row">
          <span>
            ค่าสนาม ({courts.length} คอร์ต รวม {formatHours(totalHours)} ชม.)
          </span>
          <span className="mono">{formatBaht(courtTotal)} บาท</span>
        </div>
        <div className="billing-summary-row">
          <span>ค่าลูกแบด ({shuttleCount} ลูก)</span>
          <span className="mono">{formatBaht(shuttleTotal)} บาท</span>
        </div>
        <div className="billing-summary-row">
          <span>ยอดรวมทั้งหมด</span>
          <span className="mono">{formatBaht(total)} บาท</span>
        </div>
        {byGames ? (
          <>
            {/* หนึ่งเกมมี 4 คน — 5 เกมจึงเป็น 20 ส่วน ใครเล่นกี่เกมก็จ่ายกี่ส่วน */}
            <div className="billing-summary-row">
              <span>เกมของผู้ร่วมจ่ายรวมกัน</span>
              <span className="mono">{payerGames} เกม</span>
            </div>
            <div className="billing-summary-row highlight">
              <span>เกมละ (ต่อคน)</span>
              <span className="mono">{formatBaht(perGame)} บาท</span>
            </div>
          </>
        ) : (
          <>
            <div className="billing-summary-row">
              <span>หารเท่ากันระหว่าง</span>
              <span className="mono">{payerCount} คน</span>
            </div>
            <div className="billing-summary-row highlight">
              <span>ต่อคน</span>
              <span className="mono">{formatBaht(perPerson)} บาท</span>
            </div>
          </>
        )}
      </div>
      {byGames && payerGames === 0 && total > 0 && (
        <p className="panel-hint">ยังไม่มีเกมที่จบ — ยอดรายคนจะขึ้นเมื่อจบเกมแรก</p>
      )}

      <div className="billing-players">
        <h3>ผู้ร่วมจ่าย ({payerCount}/{present.length})</h3>
        <ul className="billing-list">
          {present.map((p) => {
            const isPaying = isPayer(p)
            return (
              <li key={p.id} className={`billing-item ${isPaying ? '' : 'excluded'}`}>
                <label className="billing-checkbox">
                  <input
                    type="checkbox"
                    checked={isPaying}
                    disabled={readOnly}
                    onChange={() => onTogglePaying(p.id)}
                  />
                  {/* ห่ออีกชั้นเพราะ label เป็น flex — ไม่งั้นช่องว่างในชื่อหาย */}
                  <span>
                    <NameText name={p.name} />
                  </span>
                </label>
                <span className="billing-amount mono">
                  {!isPaying
                    ? 'ไม่ร่วมจ่าย'
                    : byGames
                      ? `${p.gamesPlayed} เกม · ${formatBaht(shares.get(p.id) ?? 0)} บาท`
                      : `${formatBaht(perPerson)} บาท`}
                </span>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
