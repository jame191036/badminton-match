function toNumber(v) {
  const n = parseFloat(v)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

function formatBaht(n) {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function BillingPanel({ players, billing, onChangeBilling, onTogglePaying }) {
  const courtFee = toNumber(billing.courtFee)
  const shuttleFee = toNumber(billing.shuttleFee)
  const total = courtFee + shuttleFee

  const payers = players.filter((p) => p.paying !== false)
  const payerCount = payers.length

  const perCourt = payerCount > 0 ? courtFee / payerCount : 0
  const perShuttle = payerCount > 0 ? shuttleFee / payerCount : 0
  const perTotal = perCourt + perShuttle

  if (players.length === 0) {
    return <p className="empty-state">เพิ่มผู้เล่นก่อน ถึงจะหารค่าใช้จ่ายได้</p>
  }

  return (
    <div className="billing">
      <div className="billing-inputs">
        <label className="billing-field">
          <span>ค่าสนามรวม (บาท)</span>
          <input
            type="number"
            min="0"
            inputMode="decimal"
            placeholder="0"
            value={billing.courtFee}
            onChange={(e) => onChangeBilling({ ...billing, courtFee: e.target.value })}
          />
        </label>
        <label className="billing-field">
          <span>ค่าลูกแบดรวม (บาท)</span>
          <input
            type="number"
            min="0"
            inputMode="decimal"
            placeholder="0"
            value={billing.shuttleFee}
            onChange={(e) => onChangeBilling({ ...billing, shuttleFee: e.target.value })}
          />
        </label>
      </div>

      <div className="billing-summary">
        <div className="billing-summary-row">
          <span>ยอดรวมทั้งหมด</span>
          <span className="mono">{formatBaht(total)} บาท</span>
        </div>
        <div className="billing-summary-row">
          <span>หารเท่ากันระหว่าง</span>
          <span className="mono">{payerCount} คน</span>
        </div>
        <div className="billing-summary-row highlight">
          <span>ต่อคน (สนาม + ลูกแบด)</span>
          <span className="mono">{formatBaht(perTotal)} บาท</span>
        </div>
      </div>

      <div className="billing-players">
        <h3>ผู้ร่วมจ่าย ({payerCount}/{players.length})</h3>
        <ul className="billing-list">
          {players.map((p) => {
            const isPaying = p.paying !== false
            return (
              <li key={p.id} className={`billing-item ${isPaying ? '' : 'excluded'}`}>
                <label className="billing-checkbox">
                  <input
                    type="checkbox"
                    checked={isPaying}
                    onChange={() => onTogglePaying(p.id)}
                  />
                  <span>{p.name}</span>
                </label>
                <span className="billing-amount mono">
                  {isPaying ? `${formatBaht(perTotal)} บาท` : 'ไม่ร่วมจ่าย'}
                </span>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
