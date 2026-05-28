import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { fetchSession } from '../../lib/api'

export const Route = createFileRoute('/sessions/$sessionId')({
  component: SessionDetail,
})

function SessionDetail() {
  const { sessionId } = Route.useParams()
  const { data, isLoading, error } = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => fetchSession(sessionId),
  })

  if (isLoading) return <p className="text-neutral-500">Loading…</p>
  if (error) return <p className="text-red-600">Error: {String(error)}</p>
  if (!data) return <p>Not found</p>

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">
          {data.session.projectName} / {data.session.serviceName}
        </h2>
        <p className="text-xs font-mono text-neutral-500">{data.session.traceId}</p>
      </div>
      <pre className="text-xs bg-neutral-100 p-4 rounded overflow-auto max-h-[80vh]">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  )
}
