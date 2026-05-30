import { createRootRoute, Outlet } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { AuthProvider, useAuth } from '../lib/auth-provider'
import { AppShell } from '../components/layout/AppShell'

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
      <div className="flex h-screen items-center justify-center u-body text-text-3">
        {t('common.loading')}
      </div>
    )
  }

  if (!user) {
    return (
      <div className="h-screen bg-page text-text-2">
        <Outlet />
      </div>
    )
  }

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  )
}
