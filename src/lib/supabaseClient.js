import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    'ไม่พบ VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — ตรวจสอบไฟล์ .env (ดู .env.example)'
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
