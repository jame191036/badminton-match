import { useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useLoad } from './useLoad'

/**
 * CRUD ของตาราง master ที่ผูกกับเจ้าของบัญชี (venues, shuttle_brands)
 * ทุกตารางนี้เป็นตารางเดียวจบ จึงเขียนตรงผ่าน supabase.from() ได้
 * ไม่ต้องมี RPC (กฎของโปรเจค: RPC ใช้เมื่อแตะหลายตารางเท่านั้น)
 *
 * RLS บังคับ owner_id อยู่แล้ว การใส่ owner_id ตอน insert จึงเป็นการ
 * บอกค่าให้ครบ ไม่ใช่การตรวจสิทธิ์
 */
export function useMasterList(table, userId) {
  const fetcher = useCallback(
    () => (userId ? supabase.from(table).select('*').eq('owner_id', userId).order('name') : null),
    [table, userId],
  )
  const { data, loading, error, refetch } = useLoad(fetcher)

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
    items: data ?? [],
    loading,
    error,
    add,
    update,
    remove,
    refetch,
  }
}
