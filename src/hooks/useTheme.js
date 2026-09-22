import { useEffect, useState } from 'react'

const KEY = 'badminton:theme'

function getSystemPreference() {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

// ค่าเก่าถูกเก็บแบบ JSON ('"dark"') จึงยัง parse อยู่ — localStorage อาจใช้ไม่ได้
// (private browsing, quota) ก็แค่ตกไปใช้ธีมของระบบ
function readStored() {
  try {
    return JSON.parse(localStorage.getItem(KEY))
  } catch {
    return null
  }
}

export function useTheme() {
  const [theme, setTheme] = useState(readStored)
  const activeTheme = theme ?? getSystemPreference()

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', activeTheme)
  }, [activeTheme])

  function toggleTheme() {
    const next = activeTheme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    try {
      localStorage.setItem(KEY, JSON.stringify(next))
    } catch {
      // storage unavailable - fail silently
    }
  }

  return { theme: activeTheme, toggleTheme }
}
