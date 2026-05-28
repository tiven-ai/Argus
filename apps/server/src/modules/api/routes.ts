import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import type { StorageBackend } from '../storage/types.js'
import { DEFAULT_ORG_ID } from '../../constants.js'
import { storedStepToApi } from './mappers.js'

export interface ApiRoutesDeps {
  storage: StorageBackend
}

export const apiRoutes: FastifyPluginAsync<ApiRoutesDeps> = async (app: FastifyInstance, deps) => {
  app.get('/api/sessions', async (request) => {
    const query = request.query as { limit?: string }
    const limit = query.limit ? Math.min(200, Math.max(1, parseInt(query.limit, 10))) : 50
    const sessions = await deps.storage.listSessions({ orgId: DEFAULT_ORG_ID, limit })
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
    const { sessionId } = request.params as { sessionId: string }
    const detail = await deps.storage.getSession({ orgId: DEFAULT_ORG_ID, sessionId })
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
