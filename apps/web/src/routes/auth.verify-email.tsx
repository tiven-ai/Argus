import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'

const searchSchema = z.object({ token: z.string().optional() })

export const Route = createFileRoute('/auth/verify-email')({
  validateSearch: searchSchema,
  component: VerifyEmailPage,
})

type State = 'verifying' | 'success' | 'failed'

function VerifyEmailPage() {
  const { t } = useTranslation()
  const { token } = Route.useSearch()
  const [state, setState] = useState<State>('verifying')

  useEffect(() => {
    let cancelled = false
    async function confirm() {
      if (!token) {
        setState('failed')
        return
      }
      try {
        const res = await fetch('/auth/email-verify/confirm', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token }),
        })
        if (cancelled) return
        setState(res.ok ? 'success' : 'failed')
      } catch {
        if (!cancelled) setState('failed')
      }
    }
    void confirm()
    return () => {
      cancelled = true
    }
  }, [token])

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-page">
      <div className="w-full max-w-sm space-y-4 border border-hairline rounded p-6 text-center">
        {state === 'verifying' && (
          <p className="u-body text-text-2">{t('auth.verifyEmail.verifying')}</p>
        )}
        {state === 'success' && (
          <>
            <p className="u-h-lg text-success">{t('auth.verifyEmail.success')}</p>
            <Link to="/sessions" className="u-body text-brand hover:text-brand-hover">
              {t('auth.verifyEmail.goSessions')}
            </Link>
          </>
        )}
        {state === 'failed' && (
          <>
            <p className="u-h-lg text-danger">{t('auth.verifyEmail.failed')}</p>
            <Link to="/login" className="u-body text-brand hover:text-brand-hover">
              {t('auth.verifyEmail.goLogin')}
            </Link>
          </>
        )}
      </div>
    </div>
  )
}
