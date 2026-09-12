/**
 * โครงร่างระหว่างโหลด — ใช้แทนข้อความ "กำลังโหลด..."
 *
 * รูปร่างตั้งใจให้ใกล้เคียงของจริง (สูงเท่ากัน จำนวนแถวพอๆ กัน)
 * เพื่อไม่ให้หน้ากระตุกตอนข้อมูลมาถึงแล้วแทนที่
 *
 * การเคลื่อนไหวถูกปิดอัตโนมัติเมื่อผู้ใช้ตั้ง prefers-reduced-motion
 * (กฎรวมอยู่ใน index.css) เหลือเป็นแถบสีเทานิ่งๆ ซึ่งยังสื่อความหมายได้
 */
export function Skeleton({ w = '100%', h = 14, r = 6, style }) {
  return <span className="skeleton" style={{ width: w, height: h, borderRadius: r, ...style }} />
}

/** ลิสต์การ์ด: ใช้กับรายการก๊วน วันเล่น และข้อมูลหลัก ซึ่งหน้าตาเป็นแถวการ์ดเหมือนกัน */
export function SkeletonList({ count = 3, lines = 2 }) {
  return (
    <ul className="master-list" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="skeleton-card">
          <div className="skeleton-line">
            <Skeleton w={`${45 + ((i * 13) % 30)}%`} h={16} />
            <Skeleton w={64} h={18} r={999} />
          </div>
          {lines > 1 && <Skeleton w={`${60 + ((i * 7) % 25)}%`} h={11} />}
        </li>
      ))}
    </ul>
  )
}

/** หัวเรื่องของหน้า (ชื่อก๊วน / วันที่) พร้อมบรรทัดรายละเอียด */
export function SkeletonHead() {
  return (
    <div className="skeleton-head" aria-hidden="true">
      <Skeleton w={90} h={11} />
      <Skeleton w="55%" h={22} />
      <Skeleton w="40%" h={12} />
    </div>
  )
}

/** แถบคิวผู้เล่น */
export function SkeletonQueue({ count = 4 }) {
  return (
    <div className="skeleton-queue" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton-line">
          <Skeleton w={20} h={20} r={999} />
          <Skeleton w={`${30 + ((i * 11) % 25)}%`} h={14} />
          <Skeleton w={56} h={18} r={999} />
        </div>
      ))}
    </div>
  )
}

/** การ์ดคอร์ต */
export function SkeletonCourts({ count = 2 }) {
  return (
    <div className="skeleton-courts" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton-card">
          <Skeleton w="40%" h={16} />
          <Skeleton w="100%" h={44} r={10} />
          <div className="skeleton-line">
            <Skeleton w="48%" h={30} r={8} />
            <Skeleton w="48%" h={30} r={8} />
          </div>
        </div>
      ))}
    </div>
  )
}
