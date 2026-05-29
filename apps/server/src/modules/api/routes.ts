import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import type { StorageBackend } from '../storage/types.js'
import { storedStepToApi } from './mappers.js'

export interface ApiRoutesDeps {
  storage: StorageBackend
}

export const apiRoutes: FastifyPluginAsync<ApiRoutesDeps> = async (app: FastifyInstance, deps) => {
  app.get('/api/sessions', async (request, reply) => {
    if (!request.auth) {
      reply.code(401)
      return { error: 'unauthenticated' }
    }
    const query = request.query as { limit?: string }
    const limit = query.limit ? Math.min(200, Math.max(1, parseInt(query.limit, 10))) : 50
    const orgId = request.auth.user.orgId
    const sessions = await request.server.withTenantTx(orgId, (trx) =>
      deps.storage.listSessions(trx, { orgId, limit }),
    )
    return {
      sessions: sessions.map((s) => ({
        id: s.id,
        traceId: s.traceId,
        projectName: s.projectName,
        serviceName: s.serviceName,
        startedAt: s.startedAt.toISOString(),
        endedAt: s.endedAt ? s.endedAt.toISOString() : null,
        stepCount: s.stepCount,
      })),
    }
  })

  app.get('/api/sessions/:sessionId', async (request, reply) => {
    if (!request.auth) {
      reply.code(401)
      return { error: 'unauthenticated' }
    }
    const { sessionId } = request.params as { sessionId: string }
    const orgId = request.auth.user.orgId
    const detail = await request.server.withTenantTx(orgId, (trx) =>
      deps.storage.getSession(trx, { orgId, sessionId }),
    )
    if (!detail) {
      reply.code(404)
      return { error: 'not_found' }
    }
    return {
      session: {
        id: detail.id,
        traceId: detail.traceId,
        projectName: detail.projectName,
        serviceName: detail.serviceName,
        startedAt: detail.startedAt.toISOString(),
        endedAt: detail.endedAt ? detail.endedAt.toISOString() : null,
        stepCount: detail.stepCount,
      },
      steps: detail.steps.map(storedStepToApi),
    }
  })
}
