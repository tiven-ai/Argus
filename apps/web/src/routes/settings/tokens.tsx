import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
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

  if (isLoading) return <p className="p-6 u-body text-text-3">Loading…</p>
  if (error) return <p className="p-6 u-body text-danger">Error: {String(error)}</p>

  return (
    <div className="p-6 space-y-6 overflow-auto h-full">
      <header>
        <h2 className="u-h-lg text-text-1">Ingest tokens</h2>
        <p className="u-body text-text-3 mt-1">
          Use a token in the{' '}
          <code className="bg-tile px-1 rounded text-text-2">Authorization: Bearer</code> header
          when POSTing to <code className="bg-tile px-1 rounded text-text-2">/v1/traces</code>. The
          token&apos;s project determines where the traces land.
        </p>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (projectName && tokenName) create.mutate()
        }}
        className="border border-hairline rounded p-3 space-y-3 max-w-xl"
      >
        <h3 className="u-h-md text-text-1">Create a new token</h3>
        <label className="block space-y-1">
          <span className="u-caption text-text-3">Project name</span>
          <input
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="e.g. customer-bot"
            required
            className={inputClass}
          />
        </label>
        <label className="block space-y-1">
          <span className="u-caption text-text-3">Token name</span>
          <input
            value={tokenName}
            onChange={(e) => setTokenName(e.target.value)}
            placeholder="e.g. production"
            required
            className={inputClass}
          />
        </label>
        <button
          type="submit"
          disabled={create.isPending}
          className="h-8 px-4 rounded bg-brand text-white u-body hover:bg-brand-hover transition-colors disabled:opacity-50"
        >
          {create.isPending ? 'Creating…' : 'Create token'}
        </button>
        {create.error && <p className="u-caption text-danger">{String(create.error)}</p>}
      </form>

      {revealed && (
        <div className="border border-hairline rounded p-3 space-y-2 max-w-xl">
          <p className="u-h-md text-warning">Save this token now — it will not be shown again.</p>
          <pre className="u-caption bg-tile border border-hairline p-2 rounded break-all text-text-1">
            {revealed.token}
          </pre>
          <button
            type="button"
            onClick={() => setRevealed(null)}
            className="u-caption text-text-3 hover:text-text-1 underline"
          >
            I&apos;ve saved it
          </button>
        </div>
      )}

      <section>
        <h3 className="u-h-md text-text-1 mb-2">Existing tokens</h3>
        {data && data.length === 0 && <p className="u-body text-text-3">(no tokens yet)</p>}
        {data && data.length > 0 && (
          <div className="border border-hairline rounded">
            <table className="w-full u-body">
              <thead>
                <tr className="text-left u-caption text-text-3 border-b border-hairline">
                  <th className="font-normal px-3 py-2">Project</th>
                  <th className="font-normal px-3 py-2">Name</th>
                  <th className="font-normal px-3 py-2">Prefix</th>
                  <th className="font-normal px-3 py-2">Created</th>
                  <th className="font-normal px-3 py-2">Status</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {data.map((t: TokenRecord) => (
                  <tr key={t.id} className="border-b border-hairline last:border-0">
                    <td className="px-3 py-2 text-text-1">{t.projectName}</td>
                    <td className="px-3 py-2 text-text-2">{t.name}</td>
                    <td className="px-3 py-2 font-mono u-caption text-text-3 tabular">
                      {t.prefix}…
                    </td>
                    <td className="px-3 py-2 text-text-3 tabular">
                      {new Date(t.createdAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">
                      {t.revokedAt ? (
                        <Badge variant="secondary">revoked</Badge>
                      ) : (
                        <Badge variant="default">active</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {!t.revokedAt && (
                        <button
                          type="button"
                          onClick={() => revoke.mutate(t.id)}
                          className="u-caption text-danger hover:underline"
                        >
                          Revoke
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
