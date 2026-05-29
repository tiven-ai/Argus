import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import {
  createToken,
  listTokens,
  revokeToken,
  type CreatedToken,
  type TokenRecord,
} from '../../lib/api'
import { Badge } from '@/components/ui/badge'

export const Route = createFileRoute('/settings/tokens')({
  component: TokensPage,
})

const inputClass =
  'h-8 w-full rounded border border-hairline px-3 u-body text-text-1 bg-page focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-1'

function TokensPage() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { data, isLoading, error } = useQuery({
    queryKey: ['tokens'],
    queryFn: listTokens,
    retry: false,
  })
  const [revealed, setRevealed] = useState<CreatedToken | null>(null)
  const [projectName, setProjectName] = useState('')
  const [tokenName, setTokenName] = useState('')

  const create = useMutation({
    mutationFn: () => createToken({ projectName, tokenName }),
    onSuccess: (data) => {
      setRevealed(data)
      setProjectName('')
      setTokenName('')
      void queryClient.invalidateQueries({ queryKey: ['tokens'] })
    },
  })

  const revoke = useMutation({
    mutationFn: (id: string) => revokeToken(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tokens'] })
    },
  })

  if (isLoading) return <p className="p-6 u-body text-text-3">{t('common.loading')}</p>
  if (error)
    return <p className="p-6 u-body text-danger">{t('common.error', { message: String(error) })}</p>

  return (
    <div className="p-6 space-y-6 overflow-auto h-full">
      <header>
        <h2 className="u-h-lg text-text-1">{t('tokens.title')}</h2>
        <p className="u-body text-text-3 mt-1">
          <Trans
            i18nKey="tokens.introPrefix"
            t={t}
            components={{ code: <code className="bg-tile px-1 rounded text-text-2" /> }}
          />
          <code className="bg-tile px-1 rounded text-text-2">Authorization: Bearer</code>
          {t('tokens.introMiddle')}
          <code className="bg-tile px-1 rounded text-text-2">/v1/traces</code>
          {t('tokens.introSuffix')}
        </p>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (projectName && tokenName) create.mutate()
        }}
        className="border border-hairline rounded p-3 space-y-3 max-w-xl"
      >
        <h3 className="u-h-md text-text-1">{t('tokens.create.title')}</h3>
        <label className="block space-y-1">
          <span className="u-caption text-text-3">{t('tokens.create.projectName')}</span>
          <input
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder={t('tokens.create.projectPlaceholder')}
            required
            className={inputClass}
          />
        </label>
        <label className="block space-y-1">
          <span className="u-caption text-text-3">{t('tokens.create.tokenName')}</span>
          <input
            value={tokenName}
            onChange={(e) => setTokenName(e.target.value)}
            placeholder={t('tokens.create.tokenPlaceholder')}
            required
            className={inputClass}
          />
        </label>
        <button
          type="submit"
          disabled={create.isPending}
          className="h-8 px-4 rounded bg-brand text-white u-body hover:bg-brand-hover transition-colors disabled:opacity-50"
        >
          {create.isPending ? t('tokens.create.submitting') : t('tokens.create.submit')}
        </button>
        {create.error && <p className="u-caption text-danger">{String(create.error)}</p>}
      </form>

      {revealed && (
        <div className="border border-hairline rounded p-3 space-y-2 max-w-xl">
          <p className="u-h-md text-warning">{t('tokens.reveal.warning')}</p>
          <pre className="u-caption bg-tile border border-hairline p-2 rounded break-all text-text-1">
            {revealed.token}
          </pre>
          <button
            type="button"
            onClick={() => setRevealed(null)}
            className="u-caption text-text-3 hover:text-text-1 underline"
          >
            {t('tokens.reveal.dismiss')}
          </button>
        </div>
      )}

      <section>
        <h3 className="u-h-md text-text-1 mb-2">{t('tokens.existing.title')}</h3>
        {data && data.length === 0 && (
          <p className="u-body text-text-3">{t('tokens.existing.empty')}</p>
        )}
        {data && data.length > 0 && (
          <div className="border border-hairline rounded">
            <table className="w-full u-body">
              <thead>
                <tr className="text-left u-caption text-text-3 border-b border-hairline">
                  <th className="font-normal px-3 py-2">{t('tokens.existing.columns.project')}</th>
                  <th className="font-normal px-3 py-2">{t('tokens.existing.columns.name')}</th>
                  <th className="font-normal px-3 py-2">{t('tokens.existing.columns.prefix')}</th>
                  <th className="font-normal px-3 py-2">{t('tokens.existing.columns.created')}</th>
                  <th className="font-normal px-3 py-2">{t('tokens.existing.columns.status')}</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {data.map((tok: TokenRecord) => (
                  <tr key={tok.id} className="border-b border-hairline last:border-0">
                    <td className="px-3 py-2 text-text-1">{tok.projectName}</td>
                    <td className="px-3 py-2 text-text-2">{tok.name}</td>
                    <td className="px-3 py-2 font-mono u-caption text-text-3 tabular">
                      {tok.prefix}…
                    </td>
                    <td className="px-3 py-2 text-text-3 tabular">
                      {new Date(tok.createdAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">
                      {tok.revokedAt ? (
                        <Badge variant="secondary">{t('tokens.existing.status.revoked')}</Badge>
                      ) : (
                        <Badge variant="default">{t('tokens.existing.status.active')}</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {!tok.revokedAt && (
                        <button
                          type="button"
                          onClick={() => revoke.mutate(tok.id)}
                          className="u-caption text-danger hover:underline"
                        >
                          {t('tokens.existing.revoke')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
