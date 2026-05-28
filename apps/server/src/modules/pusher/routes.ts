import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify'
import { DEFAULT_ORG_ID } from '../../constants.js'
import { storedStepToApi } from '../api/mappers.js'
import type { MessageBus, MessageHandler } from '../pubsub/types.js'
import type { Step } from '@argus/shared-types'
import type { StorageBackend } from '../storage/types.js'
import { formatSseComment, formatSseEvent } from './sse.js'

export interface PusherRoutesDeps {
  storage: StorageBackend
  bus: MessageBus
}

const HEARTBEAT_INTERVAL_MS = 15_000

export const pusherRoutes: FastifyPluginAsync<PusherRoutesDeps> = async (
  app: FastifyInstance,
  deps,
) => {
  app.get<{ Params: { sessionId: string } }>(
    '/api/sessions/:sessionId/stream',
    async (request, reply) => {
      const { sessionId } = request.params
      const lastEventId = readLastEventId(request)

      reply.hijack()
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      })

      // Initial replay: any steps written after lastEventId (if provided).
      if (lastEventId) {
        const detail = await deps.storage.getSession({
          orgId: DEFAULT_ORG_ID,
          sessionId,
        })
        if (detail) {
          const idx = detail.steps.findIndex((s) => s.id === lastEventId)
          const replay = idx >= 0 ? detail.steps.slice(idx + 1) : []
          for (const stored of replay) {
            const step = storedStepToApi(stored)
            reply.raw.write(formatSseEvent(step.id, { type: 'step', step }))
          }
        }
      }

      // Initial sync marker so the client knows the stream is live.
      reply.raw.write(formatSseEvent(undefined, { type: 'connected' }))

      // Live subscription.
      const handler: MessageHandler = (payload) => {
        const step = payload as Step
        try {
          reply.raw.write(formatSseEvent(step.id, { type: 'step', step }))
        } catch {
          // Socket already closed; cleanup will run via 'close' handler below.
        }
      }
      const unsubscribe = deps.bus.subscribe(`session:${sessionId}`, handler)

      // Heartbeat to keep proxies from closing idle connections.
      const heartbeat = setInterval(() => {
        try {
          reply.raw.write(formatSseComment('heartbeat'))
        } catch {
          // Same as above.
        }
      }, HEARTBEAT_INTERVAL_MS)

      // Cleanup when the client disconnects.
      request.raw.on('close', () => {
        unsubscribe()
        clearInterval(heartbeat)
        try {
          reply.raw.end()
        } catch {
          // already ended
        }
      })
    },
  )
}

function readLastEventId(req: FastifyRequest): string | undefined {
  // EventSource sends Last-Event-ID on auto-reconnect; check both header casings.
  const fromHeader =
    req.headers['last-event-id'] ?? (req.headers as Record<string, string>)['Last-Event-ID']
  if (typeof fromHeader === 'string' && fromHeader.length > 0) return fromHeader
  // Allow ?lastEventId=... query param for testing / curl scenarios.
  const q = req.query as { lastEventId?: string } | undefined
  return q?.lastEventId
}
