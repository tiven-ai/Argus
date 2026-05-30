import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import { listProjectsForOrg } from './dao.js'

export const projectRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get('/api/projects', async (request, reply) => {
    if (!request.auth) {
      reply.code(401)
      return { error: 'unauthenticated' }
    }
    const orgId = request.auth.user.orgId
    const projects = await request.server.withTenantTx(orgId, (trx) =>
      listProjectsForOrg(trx, orgId),
    )
    return {
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        createdAt: p.createdAt.toISOString(),
      })),
    }
  })
}
