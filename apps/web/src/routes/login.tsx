import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../lib/auth-provider'

export const Route = createFileRoute('/login')({
  component: LoginPage,
})

function LoginPage() {
  const { t } = useTranslation()
  const { login } = useAuth()
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
      await login(email, password)
      void navigate({ to: '/sessions' })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.login.failed'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-page">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-4 border border-hairline rounded p-6"
      >
        <h1 className="u-h-xl text-text-1">{t('auth.login.title')}</h1>
        <label className="block space-y-1">
          <span className="u-caption text-text-3">{t('auth.login.email')}</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="h-8 w-full rounded border border-hairline px-3 u-body text-text-1 bg-page focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-1"
          />
        </label>
        <label className="block space-y-1">
          <span className="u-caption text-text-3">{t('auth.login.password')}</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className="h-8 w-full rounded border border-hairline px-3 u-body text-text-1 bg-page focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-1"
          />
        </label>
        {error && <p className="u-caption text-danger">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full h-8 rounded bg-brand text-white u-body hover:bg-brand-hover transition-colors disabled:opacity-50"
        >
          {submitting ? t('auth.login.submitting') : t('auth.login.submit')}
        </button>
        <p className="u-caption text-center">
          <Link to="/auth/forgot-password" className="text-brand hover:text-brand-hover">
            {t('auth.login.forgot')}
          </Link>
        </p>
        <p className="u-caption text-text-3 text-center">
          {t('auth.login.noAccount')}{' '}
          <Link to="/register" className="text-brand hover:text-brand-hover">
            {t('auth.login.register')}
          </Link>
        </p>
      </form>
    </div>
  )
}
