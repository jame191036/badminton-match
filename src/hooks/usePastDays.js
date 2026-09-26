import { useCallback, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { mapDay } from './useClubDays'
import { useLoad } from './useLoad'

const PAGE_SIZE = 10

/**
 * ประวัติวันเล่นของก๊วน แบ่งหน้าฝั่ง server
 *
 * แยกจาก useClubDays เพราะคนละลักษณะ: นัดที่จะถึงมีไม่กี่รายการและต้องเห็นครบ
 * ส่วนประวัติสะสมไปเรื่อย ๆ ไม่มีวันหยุด ถ้าดึงมาทั้งหมดทุกครั้งที่เปิดหน้าก๊วน
 * ปีหน้าจะกลายเป็นหลายร้อยแถวโดยที่คนดูแค่หน้าแรก
 */
export function usePastDays(clubId) {
  const [page, setPage] = useState(0)

  const fetcher = useCallback(async () => {
    if (!clubId) return null
    const from = page * PAGE_SIZE
    // count: 'exact' ให้จำนวนทั้งหมดกลับมาด้วย ใช้คำนวณจำนวนหน้า
    const { data, count, error } = await supabase
      .from('v_club_days')
      .select('*', { count: 'exact' })
      .eq('club_id', clubId)
      .in('status', ['done', 'cancelled'])
      .order('play_date', { ascending: false })
      .range(from, from + PAGE_SIZE - 1)
    return { error, data: { rows: data ?? [], total: count ?? 0 } }
  }, [clubId, page])
  const { data, loading, error } = useLoad(fetcher)
  const days = (data?.rows ?? []).map(mapDay)
  const total = data?.total ?? 0

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  // กันหน้าค้างเกินขอบ เช่นอยู่หน้า 3 แล้วข้อมูลถูกลบจนเหลือ 2 หน้า
  const goTo = useCallback(
    (next) => setPage(Math.min(Math.max(0, next), Math.max(0, pageCount - 1))),
    [pageCount],
  )

  // offset = ลำดับของแถวแรกในหน้านี้ ไว้ให้คอลัมน์ # นับต่อข้ามหน้า
  // (หน้า 2 ต้องเริ่มที่ 11 ไม่ใช่กลับไปเริ่ม 1 ใหม่)
  return { days, loading, error, page, pageCount, total, offset: page * PAGE_SIZE, goTo }
}
