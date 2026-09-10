import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

// 1 ก๊วน = 1 ครั้งที่ไปตี — มีก๊วนที่ "เปิดอยู่" ได้ทีละอันต่อผู้ใช้
// ปิดก๊วนแล้วยอดเงิน/สถิติจะถูก freeze ไว้ในคอลัมน์ final_* ฝั่ง DB
// แล้วเปิดก๊วนใหม่โดยติ๊กเลือกสมาชิกที่จะมาเล่นครั้งนี้
export function useGameSession(userId) {
  const [sessionId, setSessionId] = useState(null)
  const [sessionName, setSessionName] = useState('')
  const [billing, setBilling] = useState({ hourlyRate: '', shuttlePrice: '', shuttleCount: '' })
  const [queueMode, setQueueMode] = useState('sequential')
  const [archive, setArchive] = useState([])
  const [loading, setLoading] = useState(true)

  const loadArchive = useCallback(async () => {
    const { data } = await supabase.from('v_session_archive').select('*').limit(30)
    setArchive(
      (data ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        closedAt: s.closed_at,
        totalFee: Number(s.final_total_fee ?? 0),
        perPerson: Number(s.final_per_person ?? 0),
        payerCount: s.final_payer_count ?? 0,
        playerCount: s.final_player_count ?? 0,
        gameCount: s.final_game_count ?? 0,
        playMinutes: s.final_play_minutes ?? 0,
        totalHours: Number(s.final_total_hours ?? 0),
      }))
    )
  }, [])

  const loadSession = useCallback(async () => {
    const { data: id, error } = await supabase.rpc('get_or_create_my_session')
    if (error) {
      console.error(error)
      return null
    }
    setSessionId(id)

    const { data: row } = await supabase
      .from('sessions')
      .select('name, hourly_rate, shuttle_price, shuttle_count, queue_mode')
      .eq('id', id)
      .single()

    if (row) {
      setSessionName(row.name ?? '')
      setBilling({
        hourlyRate: row.hourly_rate ? String(row.hourly_rate) : '',
        shuttlePrice: row.shuttle_price ? String(row.shuttle_price) : '',
        shuttleCount: row.shuttle_count ? String(row.shuttle_count) : '',
      })
      setQueueMode(row.queue_mode ?? 'sequential')
    }
    return id
  }, [])

  useEffect(() => {
    if (!userId) {
      setLoading(false)
      return
    }
    let cancelled = false

    async function init() {
      await loadSession()
      await loadArchive()
      if (!cancelled) setLoading(false)
    }

    init()
    return () => {
      cancelled = true
    }
  }, [userId, loadSession, loadArchive])

  const updateBilling = useCallback(
    async (next) => {
      setBilling(next) // optimistic update ให้ input ลื่นไหลก่อน
      if (!sessionId) return
      await supabase
        .from('sessions')
        .update({
          hourly_rate: next.hourlyRate === '' ? 0 : Number(next.hourlyRate),
          shuttle_price: next.shuttlePrice === '' ? 0 : Number(next.shuttlePrice),
          shuttle_count: next.shuttleCount === '' ? 0 : Number(next.shuttleCount),
        })
        .eq('id', sessionId)
    },
    [sessionId]
  )

  const updateQueueMode = useCallback(
    async (mode) => {
      setQueueMode(mode)
      if (!sessionId) return
      await supabase.from('sessions').update({ queue_mode: mode }).eq('id', sessionId)
    },
    [sessionId]
  )

  const renameSession = useCallback(
    async (name) => {
      setSessionName(name)
      if (!sessionId) return
      await supabase.from('sessions').update({ name }).eq('id', sessionId)
    },
    [sessionId]
  )

  // ปิดก๊วน แล้วดึงก๊วนใหม่ที่ระบบสร้างให้ทันที (get_or_create_my_session)
  const closeSession = useCallback(async () => {
    if (!sessionId) return
    const { error } = await supabase.rpc('close_session', { p_session_id: sessionId })
    if (error) throw error
    await loadArchive()
    setSessionId(null)
  }, [sessionId, loadArchive])

  const openSession = useCallback(
    async (name, memberIds) => {
      const { error } = await supabase.rpc('open_session', {
        p_name: name ?? null,
        p_member_ids: memberIds ?? [],
      })
      if (error) throw error
      await loadSession()
    },
    [loadSession]
  )

  return {
    sessionId,
    sessionName,
    billing,
    updateBilling,
    queueMode,
    updateQueueMode,
    renameSession,
    closeSession,
    openSession,
    archive,
    loading,
  }
}
