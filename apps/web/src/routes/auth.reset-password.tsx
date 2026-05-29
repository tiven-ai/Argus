import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'

const searchSchema = z.object({ token: z.string().optional() })

export const Route = createFileRoute('/auth/reset-password')({
  validateSearch: searchSchema,
  component: ResetPasswordPage,
})

function ResetPasswordPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { token } = Route.useSearch()
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!token) {
      setError(t('auth.resetPassword.failed'))
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/auth/password-reset/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, newPassword: password }),
      })
      if (!res.ok) {
        setError(t('auth.resetPassword.failed'))
      } else {
        setSuccess(true)
        setTimeout(() => navigate({ to: '/login' }), 1500)
      }
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
        <h1 className="u-h-xl text-text-1">{t('auth.resetPassword.title')}</h1>
        {success ? (
          <p className="u-body text-success">{t('auth.resetPassword.success')}</p>
        ) : (
          <>
            <label className="block space-y-1">
              <span className="u-caption text-text-3">{t('auth.resetPassword.newPassword')}</span>
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-8 w-full rounded border border-hairline px-3 u-body text-text-1 bg-page focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-1"
              />
            </label>
            {error && <p className="u-caption text-danger">{error}</p>}
            <button
              type="submit"
              disabled={submitting || !token}
              className="w-full h-8 rounded bg-brand text-white u-body hover:bg-brand-hover transition-colors disabled:opacity-50"
            >
              {submitting ? t('auth.resetPassword.submitting') : t('auth.resetPassword.submit')}
            </button>
            {error && (
              <p className="u-caption text-center">
                <Link to="/auth/forgot-password" className="text-brand hover:text-brand-hover">
                  {t('auth.resetPassword.requestAnother')}
                </Link>
              </p>
            )}
          </>
        )}
      </form>
    </div>
  )
}
