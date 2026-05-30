import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { fetchSession, fetchSessions } from '../../lib/api'
import { useSessionStream } from '../../lib/use-session-stream'
import { adjacentSessions, filterSessionsByProject } from '../../lib/sessions-select'
import { useProjectFilter } from '../../lib/use-project-filter'
import { SessionReplay } from '../../features/session-replay'
import { SessionRail } from '../../features/session-replay/rail/SessionRail'
import { TopbarActions } from '../../components/layout/topbar-slot'

const searchSchema = z.object({
  round: z.string().optional(),
})

export const Route = createFileRoute('/sessions/$sessionId')({
  validateSearch: searchSchema,
  component: SessionDetail,
})

function navBtn(enabled: boolean) {
  return enabled
    ? 'flex size-8 items-center justify-center rounded border border-hairline text-text-3 hover:bg-tile'
    : 'flex size-8 items-center justify-center rounded border border-hairline text-text-4'
}

function SessionDetail() {
  const { t } = useTranslation()
  const { sessionId } = Route.useParams()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const { project } = useProjectFilter()

  const { data, isLoading, error } = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => fetchSession(sessionId),
  })
  const { data: list } = useQuery({
    queryKey: ['sessions'],
    queryFn: () => fetchSessions(),
    retry: false,
  })
  const stream = useSessionStream(sessionId)

  const siblings = list ? filterSessionsByProject(list.sessions, project) : []
  const { prev, next } = adjacentSessions(siblings, sessionId)

  if (isLoading) return <div className="p-6 u-body text-text-3">{t('common.loading')}</div>
  if (error)
    return (
      <div className="p-6 u-body text-danger">{t('common.error', { message: String(error) })}</div>
    )
  if (!data) return <div className="p-6 u-body text-text-2">{t('common.notFound')}</div>

  return (
    <div className="grid h-full grid-cols-[auto_1fr] overflow-hidden">
      <SessionRail activeSessionId={sessionId} />
      <div className="overflow-hidden">
        <TopbarActions>
          {prev ? (
            <Link
              to="/sessions/$sessionId"
              params={{ sessionId: prev.id }}
              aria-label={t('rail.prev')}
              className={navBtn(true)}
            >
              <ChevronLeft className="size-4" />
            </Link>
          ) : (
            <span aria-label={t('rail.prev')} className={navBtn(false)}>
              <ChevronLeft className="size-4" />
            </span>
          )}
          {next ? (
            <Link
              to="/sessions/$sessionId"
              params={{ sessionId: next.id }}
              aria-label={t('rail.next')}
              className={navBtn(true)}
            >
              <ChevronRight className="size-4" />
            </Link>
          ) : (
            <span aria-label={t('rail.next')} className={navBtn(false)}>
              <ChevronRight className="size-4" />
            </span>
          )}
        </TopbarActions>

        <SessionReplay
          session={data.session}
          steps={data.steps}
          activeRoundId={search.round}
          connected={stream.connected}
          onSelectRound={(round) => navigate({ search: { round }, replace: true })}
        />
      </div>
    </div>
  )
}
