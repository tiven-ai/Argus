import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { Trans, useTranslation } from 'react-i18next'
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
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost'
    return (
      <div className="p-6 max-w-2xl">
        <h2 className="u-h-lg text-text-1 mb-2">{t('sessions.list.empty.title')}</h2>
        <p className="u-body text-text-3 mb-3">{t('sessions.list.empty.intro')}</p>
        <ol className="u-body text-text-2 space-y-3 list-decimal pl-5 mb-5">
          <li>
            <Trans
              i18nKey="sessions.list.empty.step1"
              t={t}
              components={{
                link: <Link to="/settings/tokens" className="text-brand hover:text-brand-hover" />,
              }}
            />
          </li>
          <li>
            <div>{t('sessions.list.empty.step2')}</div>
            <div className="mt-1.5 ml-1 font-mono u-caption space-y-1">
              <div>
                <span className="text-text-4 mr-2">HTTP</span>
                <code className="bg-tile px-1.5 py-0.5 rounded text-text-2">
                  POST {origin}/v1/traces
                </code>
              </div>
              <div>
                <span className="text-text-4 mr-2">gRPC</span>
                <code className="bg-tile px-1.5 py-0.5 rounded text-text-2">{host}:4317</code>
              </div>
            </div>
          </li>
          <li>
            <span>{t('sessions.list.empty.step3')} </span>
            <code className="bg-tile px-1.5 py-0.5 rounded text-text-2 font-mono u-caption">
              Authorization: Bearer &lt;your-token&gt;
            </code>
          </li>
        </ol>
        <Link
          to="/settings/tokens"
          className="inline-block h-8 px-4 leading-8 rounded bg-brand text-white u-body hover:bg-brand-hover transition-colors"
        >
          {t('sessions.list.empty.cta')}
        </Link>
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
