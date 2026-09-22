import { useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useLoad } from './useLoad'
import { groupOutstanding } from '../utils/billing'

/**
 * ยอดค้างจ่ายของก๊วน (วันที่จบแล้วแต่ยังไม่ติ๊กว่าจ่าย) + ติ๊กจ่าย/ยกเลิก
 *
 * setPaid แก้ players.paid_at ตรง ๆ (ตารางเดียว ไม่ต้องมี RPC) ส่งได้หลายแถวทีเดียว
 * เช่น "รับรวม" ยอดวันนี้กับวันก่อน ๆ ของคนเดียวกัน — RLS ยอมเฉพาะ owner/editor
 */
export function useClubOutstanding(clubId) {
  const fetcher = useCallback(
    () =>
      clubId
        ? supabase.from('v_club_outstanding').select('*').eq('club_id', clubId).order('play_date')
        : null,
    [clubId],
  )
  const { data, loading, error, refetch } = useLoad(fetcher)

  const rows = (data ?? []).map((r) => ({
    sessionId: r.session_id,
    playDate: r.play_date,
    playerId: r.player_id,
    memberId: r.member_id,
    name: r.name,
    amount: Number(r.amount),
  }))

  const setPaid = useCallback(
    async (playerIds, paid) => {
      const { error: err } = await supabase
        .from('players')
        .update({ paid_at: paid ? new Date().toISOString() : null })
        .in('id', playerIds)
      if (err) throw new Error(err.message)
      refetch()
    },
    [refetch],
  )

  return { rows, groups: groupOutstanding(rows), loading, error, setPaid, refetch }
}
