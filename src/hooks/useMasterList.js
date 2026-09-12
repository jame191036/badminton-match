import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

/**
 * CRUD ของตาราง master ที่ผูกกับเจ้าของบัญชี (venues, shuttle_brands)
 * ทุกตารางนี้เป็นตารางเดียวจบ จึงเขียนตรงผ่าน supabase.from() ได้
 * ไม่ต้องมี RPC (กฎของโปรเจค: RPC ใช้เมื่อแตะหลายตารางเท่านั้น)
 *
 * RLS บังคับ owner_id อยู่แล้ว การใส่ owner_id ตอน insert จึงเป็นการ
 * บอกค่าให้ครบ ไม่ใช่การตรวจสิทธิ์
 */
export function useMasterList(table, userId) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  const refetch = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    if (!userId) return
    let alive = true

    async function load() {
      const { data, error: err } = await supabase
        .from(table)
        .select('*')
        .eq('owner_id', userId)
        .order('name')

      if (!alive) return
      if (err) setError(err.message)
      else {
        setItems(data ?? [])
        setError('')
      }
      setLoading(false)
    }

    load()
    return () => {
      alive = false
    }
  }, [table, userId, reloadKey])

  const add = useCallback(
    async (values) => {
      const { error: err } = await supabase.from(table).insert({ ...values, owner_id: userId })
      if (err) {
        if (err.code === '23505') throw new Error(`มี "${values.name}" อยู่แล้ว`)
        throw new Error(err.message)
      }
      refetch()
    },
    [table, userId, refetch],
  )

  const update = useCallback(
    async (id, values) => {
      const { error: err } = await supabase.from(table).update(values).eq('id', id)
      if (err) {
        // unique index บน (owner_id, lower(trim(name))) — ชื่อซ้ำแบบไม่สนตัวพิมพ์
        if (err.code === '23505') throw new Error('มีชื่อนี้อยู่แล้ว')
        throw new Error(err.message)
      }
      refetch()
    },
    [table, refetch],
  )

  const remove = useCallback(
    async (id) => {
      const { error: err } = await supabase.from(table).delete().eq('id', id)
      if (err) throw new Error(err.message)
      refetch()
    },
    [table, refetch],
  )

  return {
    items,
    // ไม่มี id = ไม่ได้กำลังโหลด ไม่ใช่โหลดค้าง — คำนวณตรงนี้แทนการ
    // setState ในเอฟเฟกต์ ซึ่งทำให้เกิด render ซ้อนโดยไม่จำเป็น
    loading: userId ? loading : false,
    error,
    add,
    update,
    remove,
    refetch,
  }
}
