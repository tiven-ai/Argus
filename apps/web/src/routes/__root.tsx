import { createRootRoute, Link, Outlet } from '@tanstack/react-router'

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  return (
    <div className="h-screen flex flex-col">
      <header className="border-b px-6 py-3 flex items-center gap-4 shrink-0">
        <Link to="/" className="text-lg font-bold tracking-tight">
          Argus
        </Link>
        <nav className="text-sm text-neutral-500">
          <Link to="/sessions" className="hover:text-neutral-900">
            Sessions
          </Link>
        </nav>
      </header>
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  )
}
