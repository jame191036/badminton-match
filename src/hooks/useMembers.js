import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

// รายชื่อสมาชิกทั้งหมดของเจ้าของก๊วน พร้อมสถิติข้ามครั้ง
// สมาชิกถูกสร้างอัตโนมัติทุกครั้งที่เพิ่มผู้เล่น (ดู RPC add_player)
// hook นี้จึงมีไว้อ่านอย่างเดียว ใช้ตอนเปิดก๊วนใหม่แล้วติ๊กเลือกคน
export function useMembers(userId) {
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)

  const refetch = useCallback(async () => {
    if (!userId) return
    const { data, error } = await supabase
      .from('v_member_stats')
      .select('*')
      .order('last_played_at', { ascending: false, nullsFirst: false })

    if (error) {
      console.error(error)
      setLoading(false)
      return
    }

    setMembers(
      (data ?? []).map((m) => ({
        id: m.member_id,
        name: m.name,
        skill: m.default_skill,
        active: m.active,
        sessionsPlayed: m.sessions_played ?? 0,
        totalGames: m.total_games ?? 0,
        totalMinutes: m.total_minutes ?? 0,
        lastPlayedAt: m.last_played_at,
      }))
    )
    setLoading(false)
  }, [userId])

  useEffect(() => {
    refetch()
  }, [refetch])

  const removeMember = useCallback(
    async (id) => {
      const { error } = await supabase.from('members').delete().eq('id', id)
      if (error) console.error(error)
      else await refetch()
    },
    [refetch]
  )

  return { members, loading, refetch, removeMember }
}
