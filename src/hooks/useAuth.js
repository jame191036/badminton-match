import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

/** แปลข้อความ error ของ Supabase เป็นไทย */
function toThaiError(message) {
  const m = (message || '').toLowerCase()
  if (m.includes('invalid login credentials')) return 'อีเมลหรือรหัสผ่านไม่ถูกต้อง'
  if (m.includes('email not confirmed')) return 'ยังไม่ได้ยืนยันอีเมล กดลิงก์ยืนยันในอีเมลก่อนเข้าใช้งาน'
  if (m.includes('user already registered')) return 'อีเมลนี้สมัครไว้แล้ว ลองเข้าสู่ระบบแทน'
  if (m.includes('password should be at least')) return 'รหัสผ่านสั้นเกินไป ต้องยาวอย่างน้อย 6 ตัวอักษร'
  if (m.includes('should be different from the old')) return 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม'
  if (m.includes('rate limit') || m.includes('too many')) return 'ลองบ่อยเกินไป รอสักครู่แล้วลองใหม่'
  if (m.includes('unable to validate email')) return 'รูปแบบอีเมลไม่ถูกต้อง'
  return message || 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง'
}

function unwrap({ error }) {
  if (error) throw new Error(toThaiError(error.message))
}

export function useAuth() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [recovery, setRecovery] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((event, newSession) => {
      // ผู้ใช้กดลิงก์ "ลืมรหัสผ่าน" — มี session ชั่วคราวไว้ตั้งรหัสใหม่เท่านั้น
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
      if (event === 'SIGNED_OUT') setRecovery(false)
      setSession(newSession)
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  async function signIn(email, password) {
    unwrap(await supabase.auth.signInWithPassword({ email, password }))
  }

  /** คืน true ถ้าเข้าใช้งานได้เลย, false ถ้าต้องไปกดยืนยันอีเมลก่อน */
  async function signUp(email, password) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin },
    })
    unwrap({ error })
    return Boolean(data.session)
  }

  async function sendPasswordReset(email) {
    unwrap(
      await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      }),
    )
  }

  async function updatePassword(password) {
    unwrap(await supabase.auth.updateUser({ password }))
    setRecovery(false)
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  return {
    user: session?.user ?? null,
    loading,
    recovery,
    signIn,
    signUp,
    sendPasswordReset,
    updatePassword,
    signOut,
  }
}
