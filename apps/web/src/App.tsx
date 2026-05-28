import { useEffect, useState } from 'react'

type HealthStatus = 'loading' | 'ok' | 'error'

export default function App() {
  const [status, setStatus] = useState<HealthStatus>('loading')

  useEffect(() => {
    fetch('/healthz')
      .then((r) => r.json() as Promise<{ status: string }>)
      .then((d) => setStatus(d.status === 'ok' ? 'ok' : 'error'))
      .catch(() => setStatus('error'))
  }, [])

  return (
    <main className="min-h-screen flex items-center justify-center bg-white text-neutral-900">
      <div className="text-center space-y-4">
        <h1 className="text-5xl font-bold tracking-tight">Argus</h1>
        <p className="text-neutral-500">
          Server status: <span className="font-mono">{status}</span>
        </p>
      </div>
    </main>
  )
}
