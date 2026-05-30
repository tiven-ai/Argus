import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import type { NavEntry } from './nav-config'
import { cn } from '@/lib/utils'

export function NavItem({ entry, active }: { entry: NavEntry; active?: boolean }) {
  const { t } = useTranslation()
  const Icon = entry.icon
  const label = t(entry.labelKey)

  if (entry.soon || !entry.to) {
    return (
      <div
        title={t('shell.soonHint')}
        className="flex cursor-default items-center gap-2 rounded px-2 py-1.5 u-body text-text-4"
      >
        <Icon className="size-4 shrink-0" />
        <span className="truncate">{label}</span>
        <span className="ml-auto rounded-pill bg-tile px-1.5 py-0.5 u-caption text-text-3">
          {t('shell.soon')}
        </span>
      </div>
    )
  }

  return (
    <Link
      to={entry.to}
      className={cn(
        'relative flex items-center gap-2 rounded px-2 py-1.5 u-body transition-colors',
        active
          ? 'bg-tint-brand text-brand before:absolute before:left-0 before:top-1 before:bottom-1 before:w-0.5 before:rounded-pill before:bg-brand'
          : 'text-text-2 hover:bg-tile hover:text-text-1',
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className="truncate">{label}</span>
    </Link>
  )
}
