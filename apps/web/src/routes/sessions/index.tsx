import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { fetchSessions } from '../../lib/api'

export const Route = createFileRoute('/sessions/')({
  component: SessionsList,
})

function SessionsList() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['sessions'],
    queryFn: fetchSessions,
  })

  if (isLoading) return <p className="p-6 text-neutral-500">Loading…</p>
  if (error) return <p className="p-6 text-red-600">Error: {String(error)}</p>
  if (!data || data.sessions.length === 0) {
    return (
      <div className="p-6 text-neutral-500">
        <p>No sessions yet.</p>
        <p className="text-sm mt-2">
          Try <code className="bg-neutral-100 px-1 rounded">pnpm db:seed</code> or send an OTLP
          payload to <code className="bg-neutral-100 px-1 rounded">POST /v1/traces</code>.
        </p>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-2 overflow-auto h-full">
      <h2 className="text-lg font-semibold mb-4">Sessions</h2>
      <table className="w-full text-sm">
        <thead className="text-left text-neutral-500">
          <tr>
            <th className="py-2">Project</th>
            <th>Service</th>
            <th>Trace</th>
            <th>Steps</th>
            <th>Started</th>
          </tr>
        </thead>
        <tbody>
          {data.sessions.map((s) => (
            <tr key={s.id} className="border-t hover:bg-neutral-50">
              <td className="py-2">{s.projectName}</td>
              <td>{s.serviceName}</td>
              <td className="font-mono text-xs">
                <Link
                  to="/sessions/$sessionId"
                  params={{ sessionId: s.id }}
                  className="text-blue-700 hover:underline"
                >
                  {s.traceId.slice(0, 16)}…
                </Link>
              </td>
              <td>{s.stepCount}</td>
              <td className="text-neutral-500">{new Date(s.startedAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
