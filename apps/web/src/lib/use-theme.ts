import { useEffect, useState } from 'react'
import { resolveInitialTheme, THEME_KEY, type Theme } from './theme'

// NOTE: this hook holds local state, so it must have a SINGLE consumer (the
// Topbar) until it is lifted to shared state. A second concurrent consumer
// would desync and fight over the <html> class / localStorage. The pre-paint
// theme is applied by the inline script in index.html.
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
