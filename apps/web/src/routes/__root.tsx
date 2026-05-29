import { createRootRoute, Link, Outlet, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
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
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center text-text-3 u-body">Loading…</div>
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
            Sessions
          </Link>
          {user && (
            <Link to="/settings/tokens" className="text-text-3 hover:text-text-1 transition-colors">
              Tokens
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
  return (
    <Link to="/login" className="u-body text-brand hover:text-brand-hover transition-colors">
      Sign in
    </Link>
  )
}

function UserMenu() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)

  async function handleLogout() {
    await logout()
    setOpen(false)
    void navigate({ to: '/login' })
  }

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
        <div className="absolute right-0 mt-1 w-48 bg-popover border border-hairline rounded-md shadow-[var(--shadow-popover)] u-body z-50">
          <button
            type="button"
            onClick={handleLogout}
            className="block w-full text-left px-3 py-2 text-text-2 hover:bg-tile transition-colors rounded-md"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
