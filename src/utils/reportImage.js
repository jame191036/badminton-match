import { reportColumns, reportFileName } from './report.js'

/**
 * วาดรายงานสรุปวันเล่นลง canvas แล้วคืนเป็น PNG
 *
 * ทำไมวาดเองไม่ใช้ html2canvas: ตัวนั้นต้องดึง CSS/ฟอนต์ข้ามโดเมนมา inline
 * ซึ่งฟอนต์ไทยของเราโหลดจาก Google Fonts — พลาดบ่อยแล้วได้ฟอนต์ fallback
 * ในรูป ส่วน canvas ใช้ฟอนต์ที่หน้าเว็บโหลดไว้แล้วตรง ๆ ไทยไม่เพี้ยน
 * และได้ออกแบบรูปเพื่อส่ง LINE โดยเฉพาะ ไม่ใช่ภาพถ่ายหน้าจอที่มีปุ่มติดมา
 *
 * ไฟล์นี้ใช้ได้แต่ในเบราว์เซอร์ (ต่างจาก report.js ที่ node รันได้)
 */

// กว้าง 1080 = ขนาดที่ LINE/IG ไม่บีบซ้ำ · scale 2 ให้คมบนจอมือถือ
const W = 1080
const PAD = 56
const SCALE = 2

const FONT = {
  head: '700 46px Kanit, "IBM Plex Sans Thai", sans-serif',
  sub: '400 26px "IBM Plex Sans Thai", sans-serif',
  tileValue: '600 44px "JetBrains Mono", monospace',
  tileLabel: '400 22px "IBM Plex Sans Thai", sans-serif',
  th: '600 24px "IBM Plex Sans Thai", sans-serif',
  td: '400 28px "IBM Plex Sans Thai", sans-serif',
  tdNum: '500 28px "JetBrains Mono", monospace',
  note: '400 23px "IBM Plex Sans Thai", sans-serif',
}

// พื้นสว่างเสมอ ไม่ตามธีมของแอป — รูปไปอยู่ในแชทที่พื้นหลังขาว
// ถ้าส่งรูปธีมมืดเข้าไปจะกลายเป็นก้อนดำกลางห้องแชท
const C = {
  bg: '#ffffff',
  card: '#f4f7f5',
  ink: '#16241c',
  muted: '#5c6b62',
  faint: '#8b9a91',
  line: '#dde5e0',
  brand: '#0f7a54',
  coral: '#e8604c',
}

/** ตัดข้อความให้พอดีความกว้าง เติม … ถ้าเกิน */
function fit(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text
  let s = text
  while (s.length > 1 && ctx.measureText(s + '…').width > maxWidth) s = s.slice(0, -1)
  return s + '…'
}

// roundRect เป็น API ที่ใหม่กว่าส่วนอื่นที่ใช้อยู่ — ถ้าเบราว์เซอร์ไม่มี
// ถอยไปเป็นสี่เหลี่ยมมุมตรง เสียแค่ความสวย ดีกว่ารูปพังทั้งใบ
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r)
  else ctx.rect(x, y, w, h)
}

/**
 * คืน { blob, fileName } — ผู้เรียกเอาไปดาวน์โหลดหรือส่งต่อ navigator.share
 * ต้องรอ document.fonts.ready ก่อน ไม่งั้นรอบแรกจะวาดด้วยฟอนต์ fallback
 */
export async function renderReportImage(report) {
  if (document.fonts?.ready) await document.fonts.ready

  const cols = reportColumns(report.hasScores)
  const rowH = 54
  const tileH = 132

  // คำนวณความสูงก่อนสร้าง canvas — เนื้อหายาวไม่เท่ากันทุกวัน
  const headH = 150
  const tableH = 44 + (report.rows.length + 1) * rowH
  const notesH = report.notes.length > 0 ? 22 + report.notes.length * 34 : 0
  const H = PAD + headH + tileH + 36 + tableH + notesH + PAD + 40

  const canvas = document.createElement('canvas')
  canvas.width = W * SCALE
  canvas.height = H * SCALE
  const ctx = canvas.getContext('2d')
  ctx.scale(SCALE, SCALE)
  ctx.textBaseline = 'alphabetic'

  ctx.fillStyle = C.bg
  ctx.fillRect(0, 0, W, H)

  let y = PAD

  // ---------- หัวเรื่อง ----------
  ctx.fillStyle = C.brand
  ctx.font = FONT.head
  ctx.textAlign = 'left'
  ctx.fillText(fit(ctx, report.clubName, W - PAD * 2), PAD, y + 40)
  y += 62

  ctx.fillStyle = C.ink
  ctx.font = FONT.sub
  ctx.fillText(report.dateLabel + '  ·  ' + report.timeLabel, PAD, y + 22)
  y += 36

  ctx.fillStyle = C.muted
  ctx.fillText(fit(ctx, report.place, W - PAD * 2), PAD, y + 22)
  y += 52

  // ---------- ตัวเลขสรุป 4 ช่อง ----------
  const gap = 16
  const tileW = (W - PAD * 2 - gap * 3) / 4
  report.tiles.forEach((t, i) => {
    const x = PAD + i * (tileW + gap)
    ctx.fillStyle = C.card
    roundRect(ctx, x, y, tileW, tileH - 20, 16)
    ctx.fill()

    // สองช่องท้ายเป็นเงิน ใช้สีส้มให้ตาไปหาก่อน
    ctx.fillStyle = i >= 2 ? C.coral : C.brand
    ctx.font = FONT.tileValue
    ctx.textAlign = 'center'
    ctx.fillText(fit(ctx, t.value, tileW - 20), x + tileW / 2, y + 62)

    ctx.fillStyle = C.faint
    ctx.font = FONT.tileLabel
    ctx.fillText(t.label, x + tileW / 2, y + 96)
  })
  y += tileH + 20

  // ---------- ตารางรายคน ----------
  // คอลัมน์ชื่อ (width 0) ยืดกินที่ที่เหลือ
  const fixed = cols.reduce((s, c) => s + c.width, 0)
  const layout = []
  let x = PAD
  for (const c of cols) {
    const w = c.width || W - PAD * 2 - fixed
    layout.push({ ...c, x, w })
    x += w
  }

  ctx.textAlign = 'left'
  ctx.fillStyle = C.faint
  ctx.font = FONT.th
  for (const c of layout) {
    ctx.textAlign = c.align === 'right' ? 'right' : 'left'
    ctx.fillText(c.label, c.align === 'right' ? c.x + c.w : c.x, y + 20)
  }
  y += 34

  ctx.strokeStyle = C.line
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(PAD, y)
  ctx.lineTo(W - PAD, y)
  ctx.stroke()
  y += 10

  report.rows.forEach((r, i) => {
    // แถบสลับสีอ่อน ๆ ช่วยกวาดตาตามแถวในรูปที่ไม่มี hover
    if (i % 2 === 1) {
      ctx.fillStyle = C.card
      roundRect(ctx, PAD - 10, y - 4, W - PAD * 2 + 20, rowH - 6, 8)
      ctx.fill()
    }
    for (const c of layout) {
      const num = c.key !== 'name'
      ctx.font = num ? FONT.tdNum : FONT.td
      ctx.fillStyle = c.key === 'pos' ? C.faint : C.ink
      ctx.textAlign = c.align === 'right' ? 'right' : 'left'
      const text = String(r[c.key])
      ctx.fillText(fit(ctx, text, c.w - 12), c.align === 'right' ? c.x + c.w : c.x, y + 32)
    }
    y += rowH
  })

  // ---------- หมายเหตุท้ายรายงาน ----------
  if (report.notes.length > 0) {
    y += 18
    ctx.font = FONT.note
    ctx.fillStyle = C.muted
    ctx.textAlign = 'left'
    for (const n of report.notes) {
      ctx.fillText(fit(ctx, '· ' + n, W - PAD * 2), PAD, y + 20)
      y += 34
    }
  }

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  return { blob, fileName: reportFileName(report, 'png') }
}
