import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

/**
 * รุ่นลูกแบดทั้งหมดของยี่ห้อชุดหนึ่ง ดึงมาทีเดียวแล้วจัดกลุ่มตาม brand_id
 * (ดึงทีละยี่ห้อจะกลายเป็น N+1 query เวลามีหลายยี่ห้อ)
 *
 * shuttle_models ไม่มี owner_id — RLS ตัดสินสิทธิ์ผ่านยี่ห้อแม่ให้แล้ว
 * ฝั่งนี้จึงกรองด้วย brand_id ที่ส่งเข้ามาอย่างเดียวพอ
 */
export function useShuttleModels(brandIds) {
  const [models, setModels] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  const refetch = useCallback(() => setReloadKey((k) => k + 1), [])
  const key = brandIds.join(',')

  useEffect(() => {
    let alive = true

    async function load() {
      if (!key) {
        if (alive) {
          setModels([])
          setLoading(false)
        }
        return
      }

      const { data, error: err } = await supabase
        .from('shuttle_models')
        .select('*')
        .in('brand_id', key.split(','))
        .order('name')

      if (!alive) return
      if (err) setError(err.message)
      else {
        setModels(data ?? [])
        setError('')
      }
      setLoading(false)
    }

    load()
    return () => {
      alive = false
    }
  }, [key, reloadKey])

  const byBrand = useCallback(
    (brandId) => models.filter((m) => m.brand_id === brandId),
    [models],
  )

  const addModel = useCallback(
    async (brandId, values) => {
      const { error: err } = await supabase
        .from('shuttle_models')
        .insert({ brand_id: brandId, ...values })
      if (err) {
        if (err.code === '23505') throw new Error(`ยี่ห้อนี้มีรุ่น "${values.name}" อยู่แล้ว`)
        throw new Error(err.message)
      }
      refetch()
    },
    [refetch],
  )

  const updateModel = useCallback(
    async (id, values) => {
      const { error: err } = await supabase.from('shuttle_models').update(values).eq('id', id)
      if (err) {
        if (err.code === '23505') throw new Error('ยี่ห้อนี้มีรุ่นชื่อนี้อยู่แล้ว')
        throw new Error(err.message)
      }
      refetch()
    },
    [refetch],
  )

  const removeModel = useCallback(
    async (id) => {
      const { error: err } = await supabase.from('shuttle_models').delete().eq('id', id)
      if (err) throw new Error(err.message)
      refetch()
    },
    [refetch],
  )

  return { models, byBrand, loading, error, addModel, updateModel, removeModel, refetch }
}
