import { useRouterState } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Moon, Sun } from 'lucide-react'
import { MODULE_NAV, SETTINGS_NAV } from './nav-config'
import { CommandPlaceholder } from './CommandPlaceholder'
import { useTheme } from '@/lib/use-theme'

function useBreadcrumb(): string {
  const { t } = useTranslation()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const all = [...MODULE_NAV, ...SETTINGS_NAV]
  const match = all.find((n) => n.to && (pathname === n.to || pathname.startsWith(n.to + '/')))
  return match ? t(match.labelKey) : ''
}

export function Topbar() {
  const { t } = useTranslation()
  const crumb = useBreadcrumb()
  const { theme, toggle } = useTheme()

  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-hairline px-4">
      <div className="u-h-md text-text-1">{crumb}</div>
      <div className="ml-auto flex items-center gap-2">
        <CommandPlaceholder />
        <button
          type="button"
          onClick={toggle}
          aria-label={t('shell.theme.toggle')}
          className="flex size-8 items-center justify-center rounded border border-hairline text-text-3 hover:bg-tile"
        >
          {theme === 'dark' ? <Moon className="size-4" /> : <Sun className="size-4" />}
        </button>
      </div>
    </header>
  )
}
