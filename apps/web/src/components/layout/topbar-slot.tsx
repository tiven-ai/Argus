import { createContext, useContext, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface SlotValue {
  target: HTMLElement | null
  setTarget: (el: HTMLElement | null) => void
}

const SlotContext = createContext<SlotValue | null>(null)

export function TopbarSlotProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null)
  return <SlotContext.Provider value={{ target, setTarget }}>{children}</SlotContext.Provider>
}

/** Rendered once inside the Topbar; registers its DOM node as the portal target. */
export function TopbarSlotTarget() {
  const ctx = useContext(SlotContext)
  return <div ref={(node) => ctx?.setTarget(node)} className="flex items-center gap-2" />
}

/** Render children into the topbar's action area from any page. */
export function TopbarActions({ children }: { children: ReactNode }) {
  const ctx = useContext(SlotContext)
  if (!ctx?.target) return null
  return createPortal(children, ctx.target)
}
