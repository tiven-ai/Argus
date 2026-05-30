export type Theme = 'light' | 'dark'
export const THEME_KEY = 'argus.theme'

export function resolveInitialTheme(stored: string | null, prefersDark: boolean): Theme {
  if (stored === 'light' || stored === 'dark') return stored
  return prefersDark ? 'dark' : 'light'
}
