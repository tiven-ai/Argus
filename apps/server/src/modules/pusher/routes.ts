import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify'
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
      if (!request.auth) {
        reply.code(401)
        return { error: 'unauthenticated' }
      }
      const orgId = request.auth.user.orgId
      const { sessionId } = request.params
      const lastEventId = readLastEventId(request)

      // 404 guard: refuse to open a stream for a session that doesn't belong
      // to the requester's org. (Previously this leaked over SSE.)
      const detail = await request.server.withTenantTx(orgId, (trx) =>
        deps.storage.getSession(trx, { orgId, sessionId }),
      )
      if (!detail) {
        reply.code(404)
        return { error: 'not_found' }
      }

      reply.hijack()
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      })

      if (lastEventId) {
        const idx = detail.steps.findIndex((s) => s.id === lastEventId)
        const replay = idx >= 0 ? detail.steps.slice(idx + 1) : []
        for (const stored of replay) {
          const step = storedStepToApi(stored)
          reply.raw.write(formatSseEvent(step.id, { type: 'step', step }))
        }
      }

      reply.raw.write(formatSseEvent(undefined, { type: 'connected' }))

      const handler: MessageHandler = (payload) => {
        const step = payload as Step
        try {
          reply.raw.write(formatSseEvent(step.id, { type: 'step', step }))
        } catch {
          // socket closed; cleanup runs via 'close' below
        }
      }
      const unsubscribe = deps.bus.subscribe(`session:${sessionId}`, handler)

      const heartbeat = setInterval(() => {
        try {
          reply.raw.write(formatSseComment('heartbeat'))
        } catch {
          // ditto
        }
      }, HEARTBEAT_INTERVAL_MS)

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
  const fromHeader =
    req.headers['last-event-id'] ?? (req.headers as Record<string, string>)['Last-Event-ID']
  if (typeof fromHeader === 'string' && fromHeader.length > 0) return fromHeader
  const q = req.query as { lastEventId?: string } | undefined
  return q?.lastEventId
}
