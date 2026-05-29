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

  if (isLoading) return <p className="p-6 text-neutral-500">Loading…</p>
  if (error) return <p className="p-6 text-red-600">Error: {String(error)}</p>

  return (
    <div className="p-6 space-y-6 overflow-auto h-full">
      <header>
        <h2 className="text-lg font-semibold">Ingest tokens</h2>
        <p className="text-sm text-neutral-500">
          Use a token in the{' '}
          <code className="bg-neutral-100 px-1 rounded">Authorization: Bearer</code> header when
          POSTing to <code className="bg-neutral-100 px-1 rounded">/v1/traces</code>. The token's
          project determines where the traces land.
        </p>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (projectName && tokenName) create.mutate()
        }}
        className="border rounded p-4 space-y-3 max-w-xl"
      >
        <h3 className="text-sm font-semibold">Create a new token</h3>
        <label className="block text-sm">
          Project name
          <input
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="e.g. customer-bot"
            required
            className="mt-1 w-full border rounded px-3 py-1.5"
          />
        </label>
        <label className="block text-sm">
          Token name
          <input
            value={tokenName}
            onChange={(e) => setTokenName(e.target.value)}
            placeholder="e.g. production"
            required
            className="mt-1 w-full border rounded px-3 py-1.5"
          />
        </label>
        <button
          type="submit"
          disabled={create.isPending}
          className="bg-neutral-900 text-white rounded px-3 py-1.5 text-sm disabled:opacity-50"
        >
          {create.isPending ? 'Creating…' : 'Create token'}
        </button>
        {create.error && <p className="text-sm text-red-600">{String(create.error)}</p>}
      </form>

      {revealed && (
        <div className="border border-amber-300 bg-amber-50 rounded p-4 space-y-2 max-w-xl">
          <p className="text-sm font-semibold">Save this token now — it will not be shown again.</p>
          <pre className="text-xs bg-white border p-2 rounded break-all">{revealed.token}</pre>
          <button
            type="button"
            onClick={() => setRevealed(null)}
            className="text-sm text-neutral-700 underline"
          >
            I've saved it
          </button>
        </div>
      )}

      <section>
        <h3 className="text-sm font-semibold mb-2">Existing tokens</h3>
        {data && data.length === 0 && <p className="text-sm text-neutral-500">(no tokens yet)</p>}
        {data && data.length > 0 && (
          <table className="w-full text-sm border-t">
            <thead className="text-left text-neutral-500">
              <tr>
                <th className="py-2">Project</th>
                <th>Name</th>
                <th>Prefix</th>
                <th>Created</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.map((t: TokenRecord) => (
                <tr key={t.id} className="border-t">
                  <td className="py-2">{t.projectName}</td>
                  <td>{t.name}</td>
                  <td className="font-mono text-xs">{t.prefix}…</td>
                  <td className="text-neutral-500">{new Date(t.createdAt).toLocaleString()}</td>
                  <td>
                    {t.revokedAt ? (
                      <Badge variant="secondary">revoked</Badge>
                    ) : (
                      <Badge variant="default">active</Badge>
                    )}
                  </td>
                  <td className="text-right">
                    {!t.revokedAt && (
                      <button
                        type="button"
                        onClick={() => revoke.mutate(t.id)}
                        className="text-xs text-red-700 hover:underline"
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
