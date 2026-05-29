import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useAuth } from '../lib/auth-provider'

export const Route = createFileRoute('/register')({
  component: RegisterPage,
})

function RegisterPage() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await register(email, password)
      void navigate({ to: '/sessions' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4 border rounded p-6">
        <h1 className="text-xl font-semibold">Create your Argus account</h1>
        <label className="block">
          <span className="text-sm text-neutral-600">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="mt-1 w-full border rounded px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-sm text-neutral-600">Password (min 8 chars)</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className="mt-1 w-full border rounded px-3 py-2 text-sm"
          />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full bg-neutral-900 text-white rounded py-2 text-sm disabled:opacity-50"
        >
          {submitting ? 'Creating…' : 'Create account'}
        </button>
        <p className="text-xs text-neutral-500 text-center">
          Already have one?{' '}
          <Link to="/login" className="text-blue-700 hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  )
}
