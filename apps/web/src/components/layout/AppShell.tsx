import type { ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { VerifyNagBar } from '@/features/email-verify-nag/VerifyNagBar'

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="grid h-screen grid-cols-[auto_1fr] bg-page text-text-2">
      <Sidebar />
      <div className="grid grid-rows-[auto_auto_1fr] overflow-hidden">
        <Topbar />
        <VerifyNagBar />
        <main className="overflow-hidden">{children}</main>
      </div>
    </div>
  )
}
