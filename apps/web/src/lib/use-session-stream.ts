import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { GetSessionResponse, Step } from '@argus/shared-types'

interface UseSessionStreamResult {
  connected: boolean
}

type StreamEvent = { type: 'connected' } | { type: 'step'; step: Step }

export function useSessionStream(sessionId: string | undefined): UseSessionStreamResult {
  const queryClient = useQueryClient()
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    if (!sessionId) return
    const queryKey = ['session', sessionId]
    const es = new EventSource(`/api/sessions/${sessionId}/stream`)

    es.onopen = () => setConnected(true)

    es.onmessage = (event) => {
      let payload: StreamEvent
      try {
        payload = JSON.parse(event.data) as StreamEvent
      } catch {
        return
      }
      if (payload.type === 'connected') return
      if (payload.type === 'step') {
        const step = payload.step
        queryClient.setQueryData<GetSessionResponse>(queryKey, (prev) => {
          if (!prev) return prev
          // Dedupe by id; replace existing entry if any.
          const others = prev.steps.filter((s) => s.id !== step.id)
          const next = [...others, step].sort((a, b) => a.startedAt.localeCompare(b.startedAt))
          return {
            ...prev,
            steps: next,
            session: { ...prev.session, stepCount: next.length },
          }
        })
      }
    }

    es.onerror = () => {
      // EventSource auto-reconnects with Last-Event-ID. We only need to flip
      // the visual indicator.
      setConnected(false)
    }

    return () => {
      es.close()
      setConnected(false)
    }
  }, [sessionId, queryClient])

  return { connected }
}
