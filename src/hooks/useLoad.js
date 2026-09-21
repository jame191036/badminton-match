import { useCallback, useEffect, useState } from 'react'

/**
 * โหลดข้อมูลหนึ่งชุด แล้วโหลดใหม่เมื่อ fetcher เปลี่ยนหรือเมื่อเรียก refetch
 *
 * fetcher ต้องห่อด้วย useCallback และคืน { data, error } แบบผลของ supabase
 * คืน null = ยังไม่ต้องโหลด (เช่นยังไม่มี id)
 *
 * loading = ผลที่ถืออยู่ยังไม่ใช่ของ fetcher ตัวปัจจุบัน — คำนวณเอา ไม่ setState
 * ในเอฟเฟกต์ ส่วน refetch โหลดเงียบ ๆ ข้อมูลเดิมยังอยู่บนจอระหว่างรอ
 * error ครั้งหลังไม่ล้าง data เดิมทิ้ง
 */
export function useLoad(fetcher) {
  const [state, setState] = useState({ for: null, data: null, error: '' })
  const [reloadKey, setReloadKey] = useState(0)
  const refetch = useCallback(() => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    let alive = true
    Promise.resolve(fetcher()).then((res) => {
      if (!alive) return
      setState((prev) =>
        res?.error
          ? { for: fetcher, data: prev.data, error: res.error.message }
          : { for: fetcher, data: res?.data ?? null, error: '' },
      )
    })
    return () => {
      alive = false
    }
  }, [fetcher, reloadKey])

  return { data: state.data, loading: state.for !== fetcher, error: state.error, refetch }
}
