import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { fetchSession } from '../../lib/api'
import { useSessionStream } from '../../lib/use-session-stream'
import { SessionReplay } from '../../features/session-replay'
import type { TabKey } from '../../features/session-replay/detail/StepDetail'

const searchSchema = z.object({
  step: z.string().optional(),
  tab: z.enum(['input', 'output', 'events', 'raw']).default('input'),
})

export const Route = createFileRoute('/sessions/$sessionId')({
  validateSearch: searchSchema,
  component: SessionDetail,
})

function SessionDetail() {
  const { sessionId } = Route.useParams()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const { data, isLoading, error } = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => fetchSession(sessionId),
  })
  const stream = useSessionStream(sessionId)

  if (isLoading) return <div className="p-6 text-neutral-500">Loading…</div>
  if (error) return <div className="p-6 text-red-600">Error: {String(error)}</div>
  if (!data) return <div className="p-6">Not found</div>

  return (
    <SessionReplay
      session={data.session}
      steps={data.steps}
      activeStepId={search.step}
      activeTab={search.tab}
      connected={stream.connected}
      onSelectStep={(step) => navigate({ search: (prev) => ({ ...prev, step }), replace: true })}
      onSelectTab={(tab: TabKey) =>
        navigate({ search: (prev) => ({ ...prev, tab }), replace: true })
      }
    />
  )
}
