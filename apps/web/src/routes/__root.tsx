import { createRootRoute, Link, Outlet, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import i18n, { LOCALE_LABELS, SUPPORTED_LOCALES, type SupportedLocale } from '../i18n'
import { AuthProvider, useAuth } from '../lib/auth-provider'

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  )
}

function Shell() {
  const { t } = useTranslation()
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center text-text-3 u-body">
        {t('common.loading')}
      </div>
    )
  }
  return (
    <div className="h-screen flex flex-col bg-page text-text-2">
      <header className="border-b border-hairline px-6 py-2.5 flex items-center gap-4 shrink-0">
        <Link to="/" className="u-h-lg text-text-1 tracking-tight">
          Argus
        </Link>
        <nav className="u-body flex items-center gap-3">
          <Link to="/sessions" className="text-text-3 hover:text-text-1 transition-colors">
            {t('shell.nav.sessions')}
          </Link>
          {user && (
            <Link to="/settings/tokens" className="text-text-3 hover:text-text-1 transition-colors">
              {t('shell.nav.tokens')}
            </Link>
          )}
        </nav>
        <div className="ml-auto">{user ? <UserMenu /> : <SignInLink />}</div>
      </header>
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  )
}

function SignInLink() {
  const { t } = useTranslation()
  return (
    <Link to="/login" className="u-body text-brand hover:text-brand-hover transition-colors">
      {t('shell.auth.signIn')}
    </Link>
  )
}

function UserMenu() {
  const { t, i18n: i18nInstance } = useTranslation()
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)

  async function handleLogout() {
    await logout()
    setOpen(false)
    void navigate({ to: '/login' })
  }

  function switchTo(code: SupportedLocale) {
    void i18n.changeLanguage(code)
    setOpen(false)
  }

  const current = i18nInstance.resolvedLanguage as SupportedLocale | undefined

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="h-8 px-4 rounded border border-hairline text-text-1 u-body hover:bg-tile transition-colors"
      >
        {user!.email}
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-56 bg-popover border border-hairline rounded-md shadow-[var(--shadow-popover)] u-body z-50 py-1">
          <div className="px-3 pt-1 pb-1 u-caption text-text-3">{t('shell.language')}</div>
          {SUPPORTED_LOCALES.map((code) => (
            <button
              type="button"
              key={code}
              onClick={() => switchTo(code)}
              className="flex items-center justify-between w-full text-left px-3 py-1.5 text-text-2 hover:bg-tile transition-colors"
            >
              <span>{LOCALE_LABELS[code]}</span>
              {current === code && <span className="text-brand">✓</span>}
            </button>
          ))}
          <div className="h-px bg-hairline my-1" />
          <button
            type="button"
            onClick={handleLogout}
            className="block w-full text-left px-3 py-1.5 text-text-2 hover:bg-tile transition-colors"
          >
            {t('shell.auth.signOut')}
          </button>
        </div>
      )}
    </div>
  )
}
