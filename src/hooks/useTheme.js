import { useEffect } from 'react'
import { useLocalStorage } from './useLocalStorage'

function getSystemPreference() {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function useTheme() {
  const [theme, setTheme] = useLocalStorage('badminton:theme', null)
  const activeTheme = theme ?? getSystemPreference()

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', activeTheme)
  }, [activeTheme])

  function toggleTheme() {
    setTheme(activeTheme === 'dark' ? 'light' : 'dark')
  }

  return { theme: activeTheme, toggleTheme }
}
