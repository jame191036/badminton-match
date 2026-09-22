import qrcode from 'qrcode-generator'
import { formatPromptPayId, promptPayPayload } from '../utils/promptpay'
import { formatBaht } from '../utils/billing'

/**
 * QR พร้อมเพย์พร้อมยอด — สแกนจากแอปธนาคารแล้วยอดขึ้นเอง ไม่ต้องพิมพ์
 * เป็นรูป (data URL) ไม่ใช่ innerHTML ข้อความใน QR มาจากเลขพร้อมเพย์กับยอดเท่านั้น
 */
export default function PromptPayQR({ promptpayId, promptpayName, amount, label, onClose }) {
  const qr = qrcode(0, 'M')
  qr.addData(promptPayPayload(promptpayId, amount))
  qr.make()

  return (
    <div className="qr-box">
      <img src={qr.createDataURL(6, 4)} alt={`QR พร้อมเพย์ ${formatBaht(amount)} บาท`} />
      <div className="qr-info">
        {label && <span className="qr-label">{label}</span>}
        <strong className="qr-amount mono">{formatBaht(amount)} บาท</strong>
        <span className="mono">{formatPromptPayId(promptpayId)}</span>
        {promptpayName && <span>{promptpayName}</span>}
        <button type="button" className="btn-ghost" onClick={onClose}>
          ปิด QR
        </button>
      </div>
    </div>
  )
}
