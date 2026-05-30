import { useEffect, useState } from 'react'
import { resolveInitialTheme, THEME_KEY, type Theme } from './theme'

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() =>
    resolveInitialTheme(
      typeof localStorage !== 'undefined' ? localStorage.getItem(THEME_KEY) : null,
      typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches,
    ),
  )

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  return { theme, toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) }
}
