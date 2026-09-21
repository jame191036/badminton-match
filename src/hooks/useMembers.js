import { useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useLoad } from './useLoad'

function mapMember(m) {
  return {
    id: m.member_id,
    name: m.name,
    skill: m.default_skill,
    note: m.note,
    daysPlayed: m.days_played ?? 0,
    totalGames: m.total_games ?? 0,
  }
}

/**
 * รายชื่อผู้เล่นทั้งหมดของเจ้าของบัญชี (master) — เก็บรวมชุดเดียว ไม่แยกตามก๊วน
 * อ่านผ่าน v_member_stats เพื่อให้ได้สถิติข้ามวันมาด้วย แต่เขียนลงตาราง members
 *
 * สมาชิกยังถูกสร้างอัตโนมัติเวลาเพิ่มผู้เล่นหน้างานด้วย (RPC add_player)
 * หน้านี้จึงเป็นแค่ที่จัดการรายชื่อล่วงหน้า ไม่ใช่ทางเดียวที่จะเพิ่มคนได้
 */
export function useMembers(userId) {
  const fetcher = useCallback(
    () =>
      userId
        ? supabase.from('v_member_stats').select('*').eq('owner_id', userId).order('name')
        : null,
    [userId],
  )
  const { data, loading, error, refetch } = useLoad(fetcher)

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
    members: (data ?? []).map(mapMember),
    loading,
    error,
    addMember,
    updateMember,
    removeMember,
    refetch,
  }
}
