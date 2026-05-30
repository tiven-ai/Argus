import { Link, useRouterState } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { MODULE_NAV, SETTINGS_NAV } from './nav-config'
import { NavItem } from './NavItem'
import { OrgSwitcher } from './OrgSwitcher'
import { ProjectSwitcher } from './ProjectSwitcher'
import { AccountMenu } from './AccountMenu'

export function Sidebar() {
  const { t } = useTranslation()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const isActive = (to?: string) => !!to && (pathname === to || pathname.startsWith(to + '/'))

  return (
    <aside className="flex h-full w-60 flex-col border-r border-hairline bg-sidebar">
      <div className="flex items-center px-4 py-3">
        <Link to="/" className="u-h-lg tracking-tight text-text-1">
          Argus
        </Link>
      </div>

      <div className="space-y-2 px-3">
        <OrgSwitcher />
        <ProjectSwitcher />
      </div>

      <nav className="mt-4 flex-1 space-y-0.5 overflow-y-auto px-3">
        <div className="px-2 pb-1 pt-2 u-h-sm text-text-3">{t('shell.sectionObserve')}</div>
        {MODULE_NAV.map((entry) => (
          <NavItem key={entry.key} entry={entry} active={isActive(entry.to)} />
        ))}

        <div className="my-2 h-px bg-hairline" />
        <div className="px-2 pb-1 pt-2 u-h-sm text-text-3">{t('shell.settingsHeading')}</div>
        {SETTINGS_NAV.map((entry) => (
          <NavItem key={entry.key} entry={entry} active={isActive(entry.to)} />
        ))}
      </nav>

      <div className="border-t border-hairline px-3 py-2">
        <AccountMenu />
      </div>
    </aside>
  )
}
