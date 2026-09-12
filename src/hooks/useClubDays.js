import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

function mapDay(row) {
  return {
    id: row.session_id,
    clubId: row.club_id,
    playDate: row.play_date,
    startTime: row.start_time,
    endTime: row.end_time,
    status: row.status,
    venueName: row.venue_name,
    shuttleBrandName: row.shuttle_brand_name,
    closedAt: row.closed_at,
    totalFee: Number(row.total_fee ?? 0),
    perPerson: Number(row.per_person ?? 0),
    totalHours: Number(row.total_hours ?? 0),
    playerCount: Number(row.player_count ?? 0),
    gameCount: Number(row.game_count ?? 0),
    playMinutes: Number(row.play_minutes ?? 0),
  }
}

/**
 * ก๊วนหนึ่งก๊วน พร้อมรายการวันเล่นทั้งหมด
 *
 * v_club_days อ่านยอดของวันที่จบแล้วจาก final_* ที่ freeze ไว้ ไม่คำนวณสดใหม่
 * (ถ้าคำนวณสด พอแก้เรทค่าสนามทีหลัง ยอดของวันเก่าจะเปลี่ยนตามทั้งที่จ่ายกันไปแล้ว)
 */
export function useClubDays(clubId) {
  const [club, setClub] = useState(null)
  const [days, setDays] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  const refetch = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    if (!clubId) return
    let alive = true

    async function load() {
      const [clubRes, daysRes] = await Promise.all([
        supabase.from('v_my_clubs').select('*').eq('id', clubId).maybeSingle(),
        // เอาเฉพาะวันที่ยังต้องจัดการ — ประวัติที่จบแล้วโหลดแยกแบบแบ่งหน้า
        // (usePastDays) เพราะมันสะสมไปเรื่อย ๆ ไม่มีวันหยุด
        supabase
          .from('v_club_days')
          .select('*')
          .eq('club_id', clubId)
          .in('status', ['planned', 'playing']),
      ])

      if (!alive) return

      if (clubRes.error || daysRes.error) {
        setError((clubRes.error ?? daysRes.error).message)
      } else {
        setError('')
        setClub(
          clubRes.data
            ? {
                id: clubRes.data.id,
                ownerId: clubRes.data.owner_id,
                name: clubRes.data.name,
                note: clubRes.data.note,
                role: clubRes.data.role,
                isMine: clubRes.data.is_mine,
                playingSessionId: clubRes.data.playing_session_id,
                // นับจาก view ไม่ได้นับจากแถวที่โหลดมา เพราะประวัติไม่ได้โหลดครบ
                doneDays: clubRes.data.done_days ?? 0,
                plannedDays: clubRes.data.planned_days ?? 0,
                cancelledDays: clubRes.data.cancelled_days ?? 0,
                // รวมทุกสถานะ รวม playing กับ cancelled ที่สองตัวบนไม่ได้นับ
                totalDays: clubRes.data.total_days ?? 0,
              }
            : null,
        )
        setDays((daysRes.data ?? []).map(mapDay))
      }
      setLoading(false)
    }

    load()
    return () => {
      alive = false
    }
  }, [clubId, reloadKey])

  /**
   * ฟังความเปลี่ยนแปลงของวันเล่นในก๊วนนี้จากเครื่องอื่น
   *
   * รายการวันเล่นจะได้ไม่ค้าง เช่นเพื่อนกดเริ่มวันจากมือถือเขา แล้วเราเปิด
   * หน้าก๊วนค้างไว้อยู่ ป้ายจะเปลี่ยนเป็น "กำลังเล่น" ให้เอง
   *
   * ที่นี่ refetch ทั้งชุดไม่ใช่อ่านจาก payload เพราะรายการเรียงและแบ่งกลุ่ม
   * ตามสถานะ การแทรกแถวเดียวให้ถูกที่ยุ่งกว่าโหลดใหม่ (ก๊วนหนึ่งมีนัดไม่กี่วัน)
   */
  useEffect(() => {
    if (!clubId) return

    const channel = supabase
      .channel(`club-days-${clubId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sessions', filter: `club_id=eq.${clubId}` },
        () => refetch(),
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [clubId, refetch])

  // ค่าตั้งต้นจากวันล่าสุดของก๊วนนี้ ใช้ prefill ฟอร์มสร้างวันเล่น
  const loadDefaults = useCallback(async () => {
    const { data, error: err } = await supabase.rpc('last_day_defaults', { p_club_id: clubId })
    if (err) throw new Error(err.message)
    return data
  }, [clubId])

  const createDay = useCallback(
    async (payload) => {
      const { data, error: err } = await supabase.rpc('create_play_day', {
        p_club_id: clubId,
        p_play_date: payload.playDate,
        p_start_time: payload.startTime || null,
        p_end_time: payload.endTime || null,
        p_venue_id: payload.venueId || null,
        p_shuttle_brand_id: payload.shuttleBrandId || null,
        p_shuttle_model_id: payload.shuttleModelId || null,
        p_hourly_rate: payload.hourlyRate ?? null,
        p_shuttle_price: payload.shuttlePrice ?? null,
        p_shuttle_count: payload.shuttleCount ?? 0,
        p_queue_mode: payload.queueMode ?? 'sequential',
        p_member_ids: payload.memberIds ?? [],
        p_courts: payload.courts ?? null,
        p_note: payload.note || null,
      })
      if (err) throw new Error(err.message)
      refetch()
      return data
    },
    [clubId, refetch],
  )

  const updateDay = useCallback(
    async (sessionId, payload) => {
      const { error: err } = await supabase.rpc("update_play_day", {
        p_session_id: sessionId,
        p_play_date: payload.playDate,
        p_start_time: payload.startTime || null,
        p_end_time: payload.endTime || null,
        p_venue_id: payload.venueId || null,
        p_shuttle_brand_id: payload.shuttleBrandId || null,
        p_shuttle_model_id: payload.shuttleModelId || null,
        p_hourly_rate: payload.hourlyRate ?? null,
        p_shuttle_price: payload.shuttlePrice ?? null,
        p_shuttle_count: payload.shuttleCount ?? 0,
        p_queue_mode: payload.queueMode ?? "sequential",
        p_courts: payload.courts ?? null,
        p_note: payload.note || null,
      })
      if (err) throw new Error(err.message)
      refetch()
    },
    [refetch],
  )

  const startDay = useCallback(
    async (sessionId) => {
      const { error: err } = await supabase.rpc('start_play_day', { p_session_id: sessionId })
      if (err) throw new Error(err.message)
      refetch()
    },
    [refetch],
  )

  const cancelDay = useCallback(
    async (sessionId) => {
      const { error: err } = await supabase.rpc('cancel_play_day', { p_session_id: sessionId })
      if (err) throw new Error(err.message)
      refetch()
    },
    [refetch],
  )

  const renameClub = useCallback(
    async (name, note) => {
      const { error: err } = await supabase
        .from('clubs')
        .update({ name: name.trim(), note: note?.trim() || null })
        .eq('id', clubId)
      if (err) throw new Error(err.message)
      refetch()
    },
    [clubId, refetch],
  )

  // ลบก๊วน = cascade ลบวันเล่น ผู้เล่น เกม และยอดเงินทั้งหมดของก๊วนนั้น
  // RLS ยอมเฉพาะเจ้าของ (policy "owner deletes club")
  const deleteClub = useCallback(async () => {
    const { error: err } = await supabase.from('clubs').delete().eq('id', clubId)
    if (err) throw new Error(err.message)
  }, [clubId])

  return {
    club,
    days,
    loading,
    error,
    refetch,
    loadDefaults,
    createDay,
    updateDay,
    startDay,
    cancelDay,
    renameClub,
    deleteClub,
  }
}
