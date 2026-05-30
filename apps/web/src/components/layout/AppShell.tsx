import type { ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { TopbarSlotProvider } from './topbar-slot'
import { VerifyNagBar } from '@/features/email-verify-nag/VerifyNagBar'

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="grid h-screen grid-rows-[auto_1fr] bg-page text-text-2">
      <VerifyNagBar />
      <div className="grid grid-cols-[auto_1fr] overflow-hidden">
        <Sidebar />
        <TopbarSlotProvider>
          <div className="grid grid-rows-[auto_1fr] overflow-hidden">
            <Topbar />
            <main className="overflow-hidden">{children}</main>
          </div>
        </TopbarSlotProvider>
      </div>
    </div>
  )
}
