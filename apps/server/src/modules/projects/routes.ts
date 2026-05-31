import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { record } from '../audit/index.js'
import { createProject, deleteProject, listProjectsForOrg, renameProject } from './dao.js'

const projectBodySchema = z.object({ name: z.string().min(1).max(255) })

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

  app.post('/api/projects', async (request, reply) => {
    if (!request.auth) {
      reply.code(401)
      return { error: 'unauthenticated' }
    }
    const parsed = projectBodySchema.safeParse(request.body)
    if (!parsed.success) {
      reply.code(400)
      return { error: 'invalid_input', issues: parsed.error.issues }
    }
    const { user } = request.auth
    const result = await request.server.withTenantTx(user.orgId, async (trx) => {
      const r = await createProject(trx, user.orgId, parsed.data.name)
      if (r.status !== 'ok') return r
      await record(trx, {
        eventType: 'project_create',
        actorUserId: user.id,
        targetKind: 'project',
        targetId: r.row.id,
        metadata: { name: r.row.name },
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      })
      return r
    })
    if (result.status === 'conflict') {
      reply.code(409)
      return { error: 'conflict' }
    }
    return {
      project: {
        id: result.row.id,
        name: result.row.name,
        createdAt: result.row.createdAt.toISOString(),
      },
    }
  })

  app.patch<{ Params: { id: string } }>('/api/projects/:id', async (request, reply) => {
    if (!request.auth) {
      reply.code(401)
      return { error: 'unauthenticated' }
    }
    const parsed = projectBodySchema.safeParse(request.body)
    if (!parsed.success) {
      reply.code(400)
      return { error: 'invalid_input', issues: parsed.error.issues }
    }
    const { user } = request.auth
    const result = await request.server.withTenantTx(user.orgId, async (trx) => {
      const r = await renameProject(trx, user.orgId, request.params.id, parsed.data.name)
      if (r.status !== 'ok') return r
      await record(trx, {
        eventType: 'project_rename',
        actorUserId: user.id,
        targetKind: 'project',
        targetId: r.row.id,
        metadata: { name: r.row.name },
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      })
      return r
    })
    if (result.status === 'not_found') {
      reply.code(404)
      return { error: 'not_found' }
    }
    if (result.status === 'conflict') {
      reply.code(409)
      return { error: 'conflict' }
    }
    return {
      project: {
        id: result.row.id,
        name: result.row.name,
        createdAt: result.row.createdAt.toISOString(),
      },
    }
  })

  app.delete<{ Params: { id: string } }>('/api/projects/:id', async (request, reply) => {
    if (!request.auth) {
      reply.code(401)
      return { error: 'unauthenticated' }
    }
    const { user } = request.auth
    const result = await request.server.withTenantTx(user.orgId, async (trx) => {
      const r = await deleteProject(trx, user.orgId, request.params.id)
      if (r.status !== 'ok') return r
      await record(trx, {
        eventType: 'project_delete',
        actorUserId: user.id,
        targetKind: 'project',
        targetId: request.params.id,
        metadata: { name: r.name },
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      })
      return r
    })
    if (result.status === 'not_found') {
      reply.code(404)
      return { error: 'not_found' }
    }
    return { ok: true }
  })
}
