import { useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useLoad } from './useLoad'

/**
 * คนที่เข้าถึงก๊วนนี้ได้ พร้อมแชร์/ถอนสิทธิ์
 * อ่านผ่าน RPC ไม่ใช่ view เพราะอีเมลอยู่ใน auth.users ซึ่ง authenticated อ่านตรงไม่ได้
 * share/revoke โยน error ให้หน้าจอแสดงเอง
 */
export function useClubMembers(clubId) {
  const fetcher = useCallback(
    () => (clubId ? supabase.rpc('list_club_members', { p_club_id: clubId }) : null),
    [clubId],
  )
  const { data, loading, error, refetch } = useLoad(fetcher)

  const share = useCallback(
    async (email, role) => {
      const { error: err } = await supabase.rpc('grant_club_access', {
        p_club_id: clubId,
        p_email: email,
        p_role: role,
      })
      if (err) throw new Error(err.message)
      refetch()
    },
    [clubId, refetch],
  )

  const revoke = useCallback(
    async (userId) => {
      const { error: err } = await supabase.rpc('revoke_club_access', {
        p_club_id: clubId,
        p_user_id: userId,
      })
      if (err) throw new Error(err.message)
      refetch()
    },
    [clubId, refetch],
  )

  return { members: data ?? [], loading, error, share, revoke }
}
