import { useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useLoad } from './useLoad'

export const ROLE_LABEL = {
  owner: 'เจ้าของ',
  editor: 'จัดก๊วนได้',
  viewer: 'ดูอย่างเดียว',
}

export function mapClub(row) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    note: row.note,
    role: row.role,
    isMine: row.is_mine,
    // นับจาก view ไม่ได้นับจากแถวที่โหลดมา เพราะประวัติไม่ได้โหลดครบ
    doneDays: row.done_days ?? 0,
    plannedDays: row.planned_days ?? 0,
    cancelledDays: row.cancelled_days ?? 0,
    // รวมทุกสถานะ รวม playing กับ cancelled ที่สองตัวบนไม่ได้นับ
    totalDays: row.total_days ?? 0,
    playingSessionId: row.playing_session_id,
    lastPlayedOn: row.last_played_on,
    nextPlayDate: row.next_play_date,
  }
}

/**
 * ก๊วนทั้งหมดที่ผู้ใช้เข้าถึงได้ — ทั้งของตัวเองและที่ถูกแชร์มา
 * v_my_clubs กรองด้วย club_access ให้แล้ว จึงไม่ต้องส่ง userId เข้าไปกรองซ้ำ
 */
export function useClubs(userId) {
  const fetcher = useCallback(
    () => (userId ? supabase.from('v_my_clubs').select('*').order('name') : null),
    [userId],
  )
  const { data, loading, error, refetch } = useLoad(fetcher)

  // ต้องผ่าน RPC: สร้างก๊วนแล้วต้องใส่แถว club_access ให้ตัวเองด้วย (2 ตาราง)
  const createClub = useCallback(
    async (name, note) => {
      const { data, error: err } = await supabase.rpc('create_club', {
        p_name: name,
        p_note: note ?? null,
      })
      if (err) throw new Error(err.message)
      refetch()
      return data
    },
    [refetch],
  )

  return {
    clubs: (data ?? []).map(mapClub),
    loading,
    error,
    createClub,
    refetch,
  }
}
