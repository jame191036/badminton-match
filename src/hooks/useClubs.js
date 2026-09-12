import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

function mapClub(row) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    note: row.note,
    active: row.active,
    role: row.role,
    isMine: row.is_mine,
    doneDays: row.done_days ?? 0,
    plannedDays: row.planned_days ?? 0,
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
  const [clubs, setClubs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  const refetch = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    if (!userId) return
    let alive = true

    async function load() {
      const { data, error: err } = await supabase
        .from('v_my_clubs')
        .select('*')
        .order('name')

      if (!alive) return
      if (err) setError(err.message)
      else {
        setClubs((data ?? []).map(mapClub))
        setError('')
      }
      setLoading(false)
    }

    load()
    return () => {
      alive = false
    }
  }, [userId, reloadKey])

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

  const updateClub = useCallback(
    async (id, values) => {
      const { error: err } = await supabase.from('clubs').update(values).eq('id', id)
      if (err) throw new Error(err.message)
      refetch()
    },
    [refetch],
  )

  const removeClub = useCallback(
    async (id) => {
      const { error: err } = await supabase.from('clubs').delete().eq('id', id)
      if (err) throw new Error(err.message)
      refetch()
    },
    [refetch],
  )

  return {
    clubs,
    loading: userId ? loading : false,
    error,
    createClub,
    updateClub,
    removeClub,
    refetch,
  }
}
