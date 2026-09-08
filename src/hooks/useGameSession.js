import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

// ตอนนี้ 1 ผู้ใช้ = 1 ก๊วน (เรียก get_or_create_my_session ครั้งเดียวหลัง login)
// วันหน้าถ้าจะรองรับหลายก๊วน ค่อยเปลี่ยนมาให้ผู้ใช้เลือก session_id เองจาก UI
export function useGameSession(userId) {
  const [sessionId, setSessionId] = useState(null)
  const [billing, setBilling] = useState({ courtFee: '', shuttleFee: '' })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!userId) {
      setLoading(false)
      return
    }
    let cancelled = false

    async function init() {
      setLoading(true)
      const { data: id, error } = await supabase.rpc('get_or_create_my_session')
      if (error) {
        console.error(error)
        setLoading(false)
        return
      }
      if (cancelled) return
      setSessionId(id)

      const { data: row } = await supabase
        .from('sessions')
        .select('court_fee, shuttle_fee')
        .eq('id', id)
        .single()

      if (row && !cancelled) {
        setBilling({
          courtFee: row.court_fee ? String(row.court_fee) : '',
          shuttleFee: row.shuttle_fee ? String(row.shuttle_fee) : '',
        })
      }
      setLoading(false)
    }

    init()
    return () => {
      cancelled = true
    }
  }, [userId])

  const updateBilling = useCallback(
    async (next) => {
      setBilling(next) // optimistic update ให้ input ลื่นไหลก่อน
      if (!sessionId) return
      await supabase
        .from('sessions')
        .update({
          court_fee: next.courtFee === '' ? 0 : Number(next.courtFee),
          shuttle_fee: next.shuttleFee === '' ? 0 : Number(next.shuttleFee),
        })
        .eq('id', sessionId)
    },
    [sessionId]
  )

  return { sessionId, billing, updateBilling, loading }
}
