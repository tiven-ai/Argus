import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { PanelLeftOpen, PanelLeftClose } from 'lucide-react'
import { fetchSessions } from '@/lib/api'
import { filterSessionsByProject } from '@/lib/sessions-select'
import { useProjectFilter } from '@/lib/use-project-filter'
import { cn } from '@/lib/utils'

export function SessionRail({ activeSessionId }: { activeSessionId: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { project } = useProjectFilter()
  const { data } = useQuery({ queryKey: ['sessions'], queryFn: fetchSessions, retry: false })
  const rows = data ? filterSessionsByProject(data.sessions, project) : []

  if (!open) {
    return (
      <div className="flex w-10 flex-col items-center border-r border-hairline bg-sidebar py-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t('rail.expand')}
          className="flex size-8 items-center justify-center rounded text-text-3 hover:bg-tile"
        >
          <PanelLeftOpen className="size-4" />
        </button>
      </div>
    )
  }

  return (
    <div className="flex w-64 flex-col border-r border-hairline bg-sidebar">
      <div className="flex items-center gap-2 border-b border-hairline px-3 py-2">
        <span className="u-h-sm text-text-3">{t('rail.title')}</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label={t('rail.collapse')}
          className="ml-auto flex size-7 items-center justify-center rounded text-text-3 hover:bg-tile"
        >
          <PanelLeftClose className="size-4" />
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto p-1">
        {rows.map((s) => (
          <Link
            key={s.id}
            to="/sessions/$sessionId"
            params={{ sessionId: s.id }}
            className={cn(
              'block rounded px-2 py-1.5',
              s.id === activeSessionId ? 'bg-tint-brand text-brand' : 'text-text-2 hover:bg-tile',
            )}
          >
            <div className="truncate u-body">{s.serviceName}</div>
            <div className="truncate u-caption text-text-3 tabular">{s.traceId.slice(0, 12)}…</div>
          </Link>
        ))}
      </nav>
    </div>
  )
}
