// PromptPay QR (มาตรฐาน EMVCo ของ ธปท.) — สร้างข้อความที่แอปธนาคารสแกนแล้วโอนได้ทันที
// เขียนเองแทนการลง library เพราะทั้งหมดคือการต่อสตริงตามสเปก + CRC ท้ายข้อความ

const tlv = (tag, value) => `${tag}${String(value.length).padStart(2, '0')}${value}`

/** CRC-16/CCITT-FALSE (poly 0x1021, เริ่ม 0xFFFF) ตามที่สเปกกำหนด คืน hex 4 หลักตัวใหญ่ */
export function crc16(text) {
  let crc = 0xffff
  for (let i = 0; i < text.length; i++) {
    crc ^= text.charCodeAt(i) << 8
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

/** รูปแบบที่ยอมรับ: เบอร์มือถือ 10 หลัก, เลขบัตรประชาชน/นิติบุคคล 13 หลัก, e-wallet 15 หลัก */
export const isPromptPayId = (id) => /^(\d{10}|\d{13}|\d{15})$/.test(id ?? '')

/**
 * ข้อความ QR พร้อมเพย์ ใส่ยอดได้ (amount = null คือ QR แบบให้ผู้โอนกรอกยอดเอง)
 *   เบอร์มือถือ 0812345678 -> 0066812345678 (ตัด 0 หน้า ใส่รหัสประเทศ)
 */
export function promptPayPayload(id, amount = null) {
  const target =
    id.length === 10 ? tlv('01', `0066${id.slice(1)}`) : id.length === 13 ? tlv('02', id) : tlv('03', id)
  const body = [
    tlv('00', '01'),
    tlv('01', amount ? '12' : '11'), // 12 = ใช้ครั้งเดียวมียอด, 11 = ใช้ซ้ำได้
    tlv('29', tlv('00', 'A000000677010111') + target),
    tlv('58', 'TH'),
    tlv('53', '764'), // THB
    amount ? tlv('54', Number(amount).toFixed(2)) : '',
  ].join('')
  const withCrcTag = `${body}6304`
  return withCrcTag + crc16(withCrcTag)
}

/** 0812345678 -> 081-234-5678 ไว้แสดงให้คนอ่าน (เลขยาวอื่นแสดงตามเดิม) */
export const formatPromptPayId = (id) =>
  id?.length === 10 ? `${id.slice(0, 3)}-${id.slice(3, 6)}-${id.slice(6)}` : id
