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
      <div className="h-screen flex items-center justify-center text-neutral-500">Loading…</div>
    )
  }
  return (
    <div className="h-screen flex flex-col">
      <header className="border-b px-6 py-3 flex items-center gap-4 shrink-0">
        <Link to="/" className="text-lg font-bold tracking-tight">
          Argus
        </Link>
        <nav className="text-sm text-neutral-500 flex items-center gap-3">
          <Link to="/sessions" className="hover:text-neutral-900">
            Sessions
          </Link>
          {user && (
            <Link to="/settings/tokens" className="hover:text-neutral-900">
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
    <Link to="/login" className="text-sm text-blue-700 hover:underline">
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
        className="text-sm text-neutral-700 hover:text-neutral-900 border rounded px-3 py-1"
      >
        {user!.email}
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-48 bg-white border rounded shadow text-sm z-50">
          <button
            type="button"
            onClick={handleLogout}
            className="block w-full text-left px-3 py-2 hover:bg-neutral-50"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
