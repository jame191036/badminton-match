import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

function mapDay(row) {
  return {
    id: row.id,
    clubId: row.club_id,
    playDate: row.play_date,
    startTime: row.start_time,
    endTime: row.end_time,
    status: row.status,
    venueName: row.venue_name,
    shuttleBrandName: row.shuttle_brand_name,
    queueMode: row.queue_mode ?? 'sequential',
    closedAt: row.closed_at,
    finals: {
      totalFee: Number(row.final_total_fee ?? 0),
      perPerson: Number(row.final_per_person ?? 0),
      payerCount: row.final_payer_count ?? 0,
      playerCount: row.final_player_count ?? 0,
      gameCount: row.final_game_count ?? 0,
      playMinutes: row.final_play_minutes ?? 0,
      totalHours: Number(row.final_total_hours ?? 0),
    },
  }
}

/**
 * วันเล่นหนึ่งวัน: ข้อมูลหัวเรื่อง ราคา และโหมดคิว
 * (คิว/คอร์ต/เกม อยู่ใน useBadmintonData แยกต่างหาก)
 */
export function usePlayDay(sessionId) {
  const [day, setDay] = useState(null)
  const [billing, setBilling] = useState({ hourlyRate: '', shuttlePrice: '', shuttleCount: '' })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  const refetch = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    if (!sessionId) return
    let alive = true

    async function load() {
      const { data, error: err } = await supabase
        .from('sessions')
        .select('*')
        .eq('id', sessionId)
        .maybeSingle()

      if (!alive) return
      if (err) setError(err.message)
      else if (data) {
        setError('')
        setDay(mapDay(data))
        setBilling({
          hourlyRate: data.hourly_rate ? String(data.hourly_rate) : '',
          shuttlePrice: data.shuttle_price ? String(data.shuttle_price) : '',
          shuttleCount: data.shuttle_count ? String(data.shuttle_count) : '',
        })
      }
      setLoading(false)
    }

    load()
    return () => {
      alive = false
    }
  }, [sessionId, reloadKey])

  const updateBilling = useCallback(
    async (next) => {
      setBilling(next) // optimistic ให้พิมพ์ลื่น ค่อยยิงขึ้น server
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
    [sessionId],
  )

  const updateQueueMode = useCallback(
    async (mode) => {
      setDay((prev) => (prev ? { ...prev, queueMode: mode } : prev))
      if (!sessionId) return
      await supabase.from('sessions').update({ queue_mode: mode }).eq('id', sessionId)
    },
    [sessionId],
  )

  const startDay = useCallback(async () => {
    const { error: err } = await supabase.rpc('start_play_day', { p_session_id: sessionId })
    if (err) throw new Error(err.message)
    refetch()
  }, [sessionId, refetch])

  // จบวัน = freeze ยอดลง final_* ฝั่ง DB แล้วแก้อะไรไม่ได้อีก
  const closeDay = useCallback(async () => {
    const { error: err } = await supabase.rpc('close_session', { p_session_id: sessionId })
    if (err) throw new Error(err.message)
    refetch()
  }, [sessionId, refetch])

  return { day, billing, loading, error, updateBilling, updateQueueMode, startDay, closeDay, refetch }
}
