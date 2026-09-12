import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

/**
 * รายชื่อผู้เล่นทั้งหมดของเจ้าของบัญชี (master) — เก็บรวมชุดเดียว ไม่แยกตามก๊วน
 * อ่านผ่าน v_member_stats เพื่อให้ได้สถิติข้ามวันมาด้วย แต่เขียนลงตาราง members
 *
 * สมาชิกยังถูกสร้างอัตโนมัติเวลาเพิ่มผู้เล่นหน้างานด้วย (RPC add_player)
 * หน้านี้จึงเป็นแค่ที่จัดการรายชื่อล่วงหน้า ไม่ใช่ทางเดียวที่จะเพิ่มคนได้
 */
export function useMembers(userId) {
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  const refetch = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    if (!userId) return
    let alive = true

    async function load() {
      const { data, error: err } = await supabase
        .from('v_member_stats')
        .select('*')
        .eq('owner_id', userId)
        .order('name')

      if (!alive) return
      if (err) {
        setError(err.message)
      } else {
        setError('')
        setMembers(
          (data ?? []).map((m) => ({
            id: m.member_id,
            name: m.name,
            skill: m.default_skill,
            note: m.note,
            active: m.active,
            daysPlayed: m.days_played ?? 0,
            totalGames: m.total_games ?? 0,
            totalMinutes: m.total_minutes ?? 0,
            lastPlayedOn: m.last_played_on,
          })),
        )
      }
      setLoading(false)
    }

    load()
    return () => {
      alive = false
    }
  }, [userId, reloadKey])

  const addMember = useCallback(
    async ({ name, skill, note }) => {
      const { error: err } = await supabase
        .from('members')
        .insert({
          owner_id: userId,
          name: name.trim(),
          default_skill: skill,
          note: note?.trim() || null,
        })
      if (err) {
        // unique index uq_members_owner_name — ชื่อซ้ำแบบไม่สนตัวพิมพ์
        if (err.code === '23505') throw new Error(`มี "${name.trim()}" อยู่ในรายชื่อแล้ว`)
        throw new Error(err.message)
      }
      refetch()
    },
    [userId, refetch],
  )

  const updateMember = useCallback(
    async (id, values) => {
      const { error: err } = await supabase.from('members').update(values).eq('id', id)
      if (err) {
        if (err.code === '23505') throw new Error('มีชื่อนี้อยู่ในรายชื่อแล้ว')
        throw new Error(err.message)
      }
      refetch()
    },
    [refetch],
  )

  // players.member_id เป็น on delete set null — ลบสมาชิกแล้วประวัติเก่ายังอยู่ครบ
  const removeMember = useCallback(
    async (id) => {
      const { error: err } = await supabase.from('members').delete().eq('id', id)
      if (err) throw new Error(err.message)
      refetch()
    },
    [refetch],
  )

  return {
    members,
    // ไม่มี id = ไม่ได้กำลังโหลด ไม่ใช่โหลดค้าง — คำนวณตรงนี้แทนการ
    // setState ในเอฟเฟกต์ ซึ่งทำให้เกิด render ซ้อนโดยไม่จำเป็น
    loading: userId ? loading : false,
    error,
    addMember,
    updateMember,
    removeMember,
    refetch,
  }
}
