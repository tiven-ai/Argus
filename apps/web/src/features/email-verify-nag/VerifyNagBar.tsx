import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../lib/auth-provider'

const DISMISS_KEY = 'argus.verifyNagDismissed'

export function VerifyNagBar() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [dismissed, setDismissed] = useState(
    () => typeof sessionStorage !== 'undefined' && sessionStorage.getItem(DISMISS_KEY) === '1',
  )
  const [resent, setResent] = useState(false)
  const [resending, setResending] = useState(false)

  if (!user || user.emailVerifiedAt !== null || dismissed) return null

  async function onResend() {
    setResending(true)
    try {
      await fetch('/auth/email-verify/request', { method: 'POST' })
      setResent(true)
      setTimeout(() => setResent(false), 5000)
    } finally {
      setResending(false)
    }
  }

  function onDismiss() {
    sessionStorage.setItem(DISMISS_KEY, '1')
    setDismissed(true)
  }

  return (
    <div className="bg-tint-warning border-b border-hairline px-6 py-2 flex items-center gap-3 u-body text-text-1">
      <span className="flex-1">
        {resent ? t('shell.verifyNag.resent') : t('shell.verifyNag.message')}
      </span>
      <button
        type="button"
        onClick={onResend}
        disabled={resending || resent}
        className="u-caption text-brand hover:text-brand-hover disabled:opacity-50"
      >
        {t('shell.verifyNag.resend')}
      </button>
      <button type="button" onClick={onDismiss} className="u-caption text-text-3 hover:text-text-1">
        {t('shell.verifyNag.dismiss')}
      </button>
    </div>
  )
}
