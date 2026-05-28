import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  beforeLoad: () => {
    // reason: /sessions route lands in M1-11
    throw redirect({ to: '/sessions' as any })
  },
})
