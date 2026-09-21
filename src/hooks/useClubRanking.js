import { useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useLoad } from './useLoad'
import { byRanking } from '../utils/ranking'

/** อันดับแพ้/ชนะรวมทุกวันเล่นของก๊วน (เฉพาะสมาชิก เฉพาะเกมที่จดแต้ม) */
export function useClubRanking(clubId) {
  const fetcher = useCallback(
    () => (clubId ? supabase.from('v_club_ranking').select('*').eq('club_id', clubId) : null),
    [clubId],
  )
  const { data, loading, error } = useLoad(fetcher)

  const rows = (data ?? [])
    .map((r) => ({
      id: r.member_id,
      name: r.name,
      wins: Number(r.wins),
      losses: Number(r.losses),
      pointDiff: Number(r.point_diff),
    }))
    .sort(byRanking)

  return { rows, loading, error }
}
