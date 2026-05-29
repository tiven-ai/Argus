import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { fetchSessions } from '../../lib/api'
import { useLocaleFormat } from '../../lib/use-locale-format'

export const Route = createFileRoute('/sessions/')({
  component: SessionsList,
})

function SessionsList() {
  const { t } = useTranslation()
  const f = useLocaleFormat()
  const navigate = useNavigate()
  const { data, isLoading, error } = useQuery({
    queryKey: ['sessions'],
    queryFn: fetchSessions,
    retry: false,
  })

  useEffect(() => {
    if (error instanceof Error && error.message === 'UNAUTHENTICATED') {
      void navigate({ to: '/login' })
    }
  }, [error, navigate])

  if (isLoading) return <p className="p-3 u-body text-text-3">{t('common.loading')}</p>
  if (error)
    return <p className="p-3 u-body text-danger">{t('common.error', { message: String(error) })}</p>
  if (!data || data.sessions.length === 0) {
    return (
      <div className="p-6 u-body text-text-3">
        <p>{t('sessions.list.empty.title')}</p>
        <p className="mt-2">
          {t('sessions.list.empty.hintPrefix')}
          <code className="bg-tile px-1 rounded text-text-2">pnpm db:seed</code>
          {t('sessions.list.empty.hintMiddle')}
          <code className="bg-tile px-1 rounded text-text-2">POST /v1/traces</code>
          {t('sessions.list.empty.hintSuffix')}
        </p>
      </div>
    )
  }

  return (
    <div className="p-6 overflow-auto h-full">
      <h2 className="u-h-lg text-text-1 mb-3">{t('sessions.list.title')}</h2>
      <div className="border border-hairline rounded">
        <table className="w-full u-body">
          <thead>
            <tr className="text-left u-caption text-text-3 border-b border-hairline">
              <th className="font-normal px-3 py-2">{t('sessions.list.columns.project')}</th>
              <th className="font-normal px-3 py-2">{t('sessions.list.columns.service')}</th>
              <th className="font-normal px-3 py-2">{t('sessions.list.columns.trace')}</th>
              <th className="font-normal px-3 py-2">{t('sessions.list.columns.steps')}</th>
              <th className="font-normal px-3 py-2">{t('sessions.list.columns.started')}</th>
            </tr>
          </thead>
          <tbody>
            {data.sessions.map((s) => (
              <tr
                key={s.id}
                className="border-b border-hairline last:border-0 hover:bg-tile transition-colors"
              >
                <td className="px-3 py-2 text-text-1">{s.projectName}</td>
                <td className="px-3 py-2 text-text-2">{s.serviceName}</td>
                <td className="px-3 py-2">
                  <Link
                    to="/sessions/$sessionId"
                    params={{ sessionId: s.id }}
                    className="font-mono text-[11px] text-brand hover:text-brand-hover tabular"
                  >
                    {s.traceId.slice(0, 16)}…
                  </Link>
                </td>
                <td className="px-3 py-2 text-text-2 tabular">{s.stepCount}</td>
                <td className="px-3 py-2 text-text-3 tabular">
                  {f.dateTime(new Date(s.startedAt))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
