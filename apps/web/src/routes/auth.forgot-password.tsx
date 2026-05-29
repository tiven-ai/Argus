import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export const Route = createFileRoute('/auth/forgot-password')({
  component: ForgotPasswordPage,
})

function ForgotPasswordPage() {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try {
      await fetch('/auth/password-reset/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      setDone(true)
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
        <h1 className="u-h-xl text-text-1">{t('auth.forgotPassword.title')}</h1>
        {done ? (
          <p className="u-body text-text-2">{t('auth.forgotPassword.confirmation')}</p>
        ) : (
          <>
            <label className="block space-y-1">
              <span className="u-caption text-text-3">{t('auth.forgotPassword.email')}</span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-8 w-full rounded border border-hairline px-3 u-body text-text-1 bg-page focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-1"
              />
            </label>
            <button
              type="submit"
              disabled={submitting}
              className="w-full h-8 rounded bg-brand text-white u-body hover:bg-brand-hover transition-colors disabled:opacity-50"
            >
              {submitting ? t('auth.forgotPassword.submitting') : t('auth.forgotPassword.submit')}
            </button>
          </>
        )}
        <p className="u-caption text-text-3 text-center">
          <Link to="/login" className="text-brand hover:text-brand-hover">
            {t('auth.forgotPassword.backToLogin')}
          </Link>
        </p>
      </form>
    </div>
  )
}
