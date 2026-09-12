import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

const PAGE_SIZE = 10

function mapDay(row) {
  return {
    id: row.session_id,
    playDate: row.play_date,
    startTime: row.start_time,
    endTime: row.end_time,
    status: row.status,
    venueName: row.venue_name,
    shuttleBrandName: row.shuttle_brand_name,
    totalFee: Number(row.total_fee ?? 0),
    perPerson: Number(row.per_person ?? 0),
    playerCount: Number(row.player_count ?? 0),
    gameCount: Number(row.game_count ?? 0),
  }
}

/**
 * ประวัติวันเล่นของก๊วน แบ่งหน้าฝั่ง server
 *
 * แยกจาก useClubDays เพราะคนละลักษณะ: นัดที่จะถึงมีไม่กี่รายการและต้องเห็นครบ
 * ส่วนประวัติสะสมไปเรื่อย ๆ ไม่มีวันหยุด ถ้าดึงมาทั้งหมดทุกครั้งที่เปิดหน้าก๊วน
 * ปีหน้าจะกลายเป็นหลายร้อยแถวโดยที่คนดูแค่หน้าแรก
 */
export function usePastDays(clubId) {
  const [days, setDays] = useState([])
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!clubId) return
    let alive = true

    async function load() {
      setLoading(true)
      const from = page * PAGE_SIZE

      // count: 'exact' ให้จำนวนทั้งหมดกลับมาด้วย ใช้คำนวณจำนวนหน้า
      const { data, count, error: err } = await supabase
        .from('v_club_days')
        .select('*', { count: 'exact' })
        .eq('club_id', clubId)
        .in('status', ['done', 'cancelled'])
        .order('play_date', { ascending: false })
        .range(from, from + PAGE_SIZE - 1)

      if (!alive) return
      if (err) setError(err.message)
      else {
        setError('')
        setDays((data ?? []).map(mapDay))
        setTotal(count ?? 0)
      }
      setLoading(false)
    }

    load()
    return () => {
      alive = false
    }
  }, [clubId, page])

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

  // กันหน้าค้างเกินขอบ เช่นอยู่หน้า 3 แล้วข้อมูลถูกลบจนเหลือ 2 หน้า
  const goTo = useCallback(
    (next) => setPage(Math.min(Math.max(0, next), Math.max(0, pageCount - 1))),
    [pageCount],
  )

  return { days, loading, error, page, pageCount, total, goTo, pageSize: PAGE_SIZE }
}
