import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

function mapDay(row) {
  return {
    id: row.id,
    playDate: row.play_date,
    startTime: row.start_time,
    endTime: row.end_time,
    status: row.status,
    venueName: row.venue_name,
    shuttleBrandName: row.shuttle_brand_name,
    // id ของ master ไว้ให้หน้าแก้ไขเลือกค่าเดิมกลับมาได้ (ชื่อเป็นแค่ snapshot)
    venueId: row.venue_id,
    shuttleBrandId: row.shuttle_brand_id,
    shuttleModelId: row.shuttle_model_id,
    queueMode: row.queue_mode ?? 'sequential',
    // บังคับพัก 1 เกมก่อนลงใหม่ — แยกจากโหมดคิว ใช้ได้กับทั้งสองโหมด
    forceRest: row.force_rest ?? true,
    finals: {
      totalFee: Number(row.final_total_fee ?? 0),
      perPerson: Number(row.final_per_person ?? 0),
      payerCount: row.final_payer_count ?? 0,
      playerCount: row.final_player_count ?? 0,
      gameCount: row.final_game_count ?? 0,
    },
  }
}

/**
 * วันเล่นหนึ่งวัน: ข้อมูลหัวเรื่อง ราคา และโหมดคิว
 * (คิว/คอร์ต/เกม อยู่ใน useBadmintonData แยกต่างหาก)
 */
export function usePlayDay(sessionId) {
  const [day, setDay] = useState(null)
  const [role, setRole] = useState(null)
  const [ownerId, setOwnerId] = useState(null)
  // ชื่อก๊วนและพร้อมเพย์ — ใช้ในข้อความสรุปยอดและ QR ของแท็บเก็บเงิน
  const [clubInfo, setClubInfo] = useState(null)
  const [billing, setBilling] = useState({ hourlyRate: '', shuttlePrice: '', shuttleCount: '' })
  // คอร์ตที่จองของวันนี้ — หน้าแก้ไขต้องใช้ ส่วนกระดานใช้ชุดของ useBadmintonData
  const [courts, setCourts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // error ของการบันทึกราคา/โหมดคิว — เดิมกลืนหายไปเฉยๆ
  const [saveError, setSaveError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  const refetch = useCallback(() => setReloadKey((k) => k + 1), [])
  const clearSaveError = useCallback(() => setSaveError(''), [])

  // เวลาที่แก้ราคาครั้งล่าสุด — ใช้กันไม่ให้ realtime เขียนทับขณะกำลังพิมพ์
  const lastEditRef = useRef(0)
  // ตัวจับเวลาหน่วงการบันทึกราคา และค่าล่าสุดที่รอเขียน
  const saveTimerRef = useRef(null)
  const pendingRef = useRef(null)

  useEffect(() => {
    if (!sessionId) return
    let alive = true

    async function load() {
      const [{ data, error: err }, courtsRes] = await Promise.all([
        supabase.from('sessions').select('*').eq('id', sessionId).maybeSingle(),
        supabase.from('courts').select('*').eq('session_id', sessionId).order('sort_order'),
      ])

      if (!alive) return
      if (err) {
        setError(err.message)
        setLoading(false)
        return
      }

      if (data) {
        setError('')
        setDay(mapDay(data))
        setCourts(courtsRes.data ?? [])
        setBilling({
          hourlyRate: data.hourly_rate ? String(data.hourly_rate) : '',
          shuttlePrice: data.shuttle_price ? String(data.shuttle_price) : '',
          shuttleCount: data.shuttle_count ? String(data.shuttle_count) : '',
        })

        // บทบาทของเราในก๊วนนี้ — ใช้ตัดสินว่าจะโชว์ปุ่มจัดการหรือไม่
        // viewer เห็นปุ่มแล้วกดไม่ได้ จะดูเหมือนแอปพัง ทั้งที่ RLS ทำงานถูก
        const { data: clubRow } = await supabase
          .from('v_my_clubs')
          .select('role, owner_id, name, promptpay_id, promptpay_name')
          .eq('id', data.club_id)
          .maybeSingle()

        if (!alive) return
        setRole(clubRow?.role ?? null)
        // ข้อมูลหลักผูกกับบัญชีเจ้าของก๊วน ไม่ใช่คนที่ล็อกอินอยู่
        setOwnerId(clubRow?.owner_id ?? null)
        setClubInfo(
          clubRow
            ? { name: clubRow.name, promptpayId: clubRow.promptpay_id, promptpayName: clubRow.promptpay_name }
            : null,
        )
      }
      setLoading(false)
    }

    load()
    return () => {
      alive = false
    }
  }, [sessionId, reloadKey])

  /** เขียนราคาที่ค้างอยู่ลง DB — เรียกจากตัวจับเวลา หรือตอนออกจากหน้า */
  const flushBilling = useCallback(async () => {
    const next = pendingRef.current
    if (!next || !sessionId) return
    pendingRef.current = null

    const { error: err } = await supabase
      .from('sessions')
      .update({
        hourly_rate: next.hourlyRate === '' ? 0 : Number(next.hourlyRate),
        shuttle_price: next.shuttlePrice === '' ? 0 : Number(next.shuttlePrice),
        shuttle_count: next.shuttleCount === '' ? 0 : Number(next.shuttleCount),
      })
      .eq('id', sessionId)

    // ถ้าไม่ดักไว้ ตัวเลขบนจอจะเปลี่ยนตามที่พิมพ์แต่ไม่ได้บันทึกจริง
    if (err) {
      console.error(err)
      setSaveError(`บันทึกราคาไม่สำเร็จ: ${err.message}`)
    } else {
      setSaveError('')
    }
  }, [sessionId])

  /**
   * แก้ราคา — ขึ้นจอทันที แต่หน่วงการเขียน DB ไว้ 600ms
   *
   * เดิมยิงทุกตัวอักษร พิมพ์ "300" = เขียน 3 ครั้ง แล้ว realtime ก็เด้งกลับมา
   * อีก 3 รอบให้ทุกเครื่องที่เปิดอยู่ เปลืองและกระตุกบนเน็ตมือถือ
   */
  const updateBilling = useCallback(
    (next) => {
      setBilling(next) // optimistic ให้พิมพ์ลื่น ค่อยยิงขึ้น server
      lastEditRef.current = Date.now()
      pendingRef.current = next

      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(flushBilling, 600)
    },
    [flushBilling],
  )

  // ปิดหน้าไปตอนยังหน่วงอยู่ ต้องเขียนให้จบ ไม่งั้นตัวเลขที่พิมพ์ล่าสุดหายเงียบ ๆ
  useEffect(() => {
    return () => {
      clearTimeout(saveTimerRef.current)
      flushBilling()
    }
  }, [flushBilling])

  /**
   * ฟังการเปลี่ยนแปลงของวันเล่นนี้จากเครื่องอื่น
   *
   * เคสที่เกิดจริงคือเพื่อนกด "เริ่มวันเล่น" หรือ "จบการเล่น" จากมือถือเขา
   * แล้วเครื่องเราต้องรู้ ไม่ใช่ค้างอยู่ที่สถานะเดิมจนกดอะไรไม่ได้
   *
   * ใช้ข้อมูลจาก payload ตรง ๆ ไม่ refetch เพราะ start/close เป็น UPDATE
   * ซึ่งส่งค่าทุกคอลัมน์มาให้อยู่แล้ว ประหยัดไปหนึ่ง round-trip
   */
  useEffect(() => {
    if (!sessionId) return

    const channel = supabase
      .channel(`session-meta-${sessionId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${sessionId}` },
        (payload) => {
          const row = payload.new
          if (!row) return
          setDay(mapDay(row))

          // ราคาอัปเดตเฉพาะตอนที่เราไม่ได้เพิ่งพิมพ์เอง ไม่งั้นตัวเลขในช่อง
          // จะกระตุกกลับระหว่างพิมพ์ (echo ของการบันทึกตัวเราเองก็เข้าทางนี้)
          if (Date.now() - lastEditRef.current > 3000) {
            setBilling({
              hourlyRate: row.hourly_rate ? String(row.hourly_rate) : '',
              shuttlePrice: row.shuttle_price ? String(row.shuttle_price) : '',
              shuttleCount: row.shuttle_count ? String(row.shuttle_count) : '',
            })
          }
        },
      )
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [sessionId])

  /**
   * เปลี่ยนการตั้งค่าการจับคู่ — โชว์บนจอทันทีแล้วค่อยยิงขึ้น server
   *
   * patch เป็นชื่อคอลัมน์จริง (snake_case) ส่วน local เป็นชื่อในรูปแบบที่
   * component ใช้ (camelCase) เขียนรวมกันเพราะสองปุ่มนี้ต่างกันแค่ชื่อคอลัมน์
   */
  const updateQueueSetting = useCallback(
    async (patch, local) => {
      setDay((prev) => (prev ? { ...prev, ...local } : prev))
      if (!sessionId) return
      const { error: err } = await supabase.from('sessions').update(patch).eq('id', sessionId)
      if (err) {
        console.error(err)
        setSaveError(`เปลี่ยนวิธีจับคู่ไม่สำเร็จ: ${err.message}`)
      } else {
        setSaveError('')
      }
    },
    [sessionId],
  )

  const updateQueueMode = useCallback(
    (mode) => updateQueueSetting({ queue_mode: mode }, { queueMode: mode }),
    [updateQueueSetting],
  )

  const updateForceRest = useCallback(
    (on) => updateQueueSetting({ force_rest: on }, { forceRest: on }),
    [updateQueueSetting],
  )

  const startDay = useCallback(async () => {
    const { error: err } = await supabase.rpc('start_play_day', { p_session_id: sessionId })
    if (err) throw new Error(err.message)
    refetch()
  }, [sessionId, refetch])

  // จบวัน = freeze ยอดลง final_* ฝั่ง DB แล้วแก้อะไรไม่ได้อีก
  //
  // ต้อง flush ราคาที่ยังหน่วงอยู่ก่อน ไม่งั้นคนพิมพ์ค่าลูกแล้วกดจบทันที
  // ยอดที่ freeze จะเป็นค่าเก่า และแก้ทีหลังไม่ได้แล้ว
  const closeDay = useCallback(async () => {
    clearTimeout(saveTimerRef.current)
    await flushBilling()
    const { error: err } = await supabase.rpc('close_session', { p_session_id: sessionId })
    if (err) throw new Error(err.message)
    refetch()
  }, [sessionId, refetch, flushBilling])

  return {
    day,
    courts,
    role,
    ownerId,
    clubInfo,
    // viewer ดูได้อย่างเดียว — ตรงกับ can_edit_session ฝั่ง DB
    canEdit: role === 'owner' || role === 'editor',
    billing,
    loading,
    error,
    saveError,
    clearSaveError,
    updateBilling,
    updateQueueMode,
    updateForceRest,
    startDay,
    closeDay,
    refetch,
  }
}
