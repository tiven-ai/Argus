import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import type { Kysely } from 'kysely'
import { z } from 'zod'
import type { DB } from '../../db/schema.js'
import { record as auditRecord } from '../audit/index.js'
import { createTokenForProject, listTokensForOrg, revokeToken } from './dao.js'

export interface TokenRoutesDeps {
  db: Kysely<DB>
}

const createTokenBodySchema = z.object({
  projectName: z.string().min(1).max(255),
  tokenName: z.string().min(1).max(255),
})

export const tokenManagementRoutes: FastifyPluginAsync<TokenRoutesDeps> = async (
  app: FastifyInstance,
  deps,
) => {
  // GET /api/tokens — list tokens for the authenticated org
  app.get('/api/tokens', async (request, reply) => {
    if (!request.auth) {
      reply.code(401)
      return { error: 'unauthenticated' }
    }
    const tokens = await listTokensForOrg(deps.db, request.auth.user.orgId)
    return {
      tokens: tokens.map((t) => ({
        id: t.id,
        projectId: t.projectId,
        projectName: t.projectName,
        name: t.name,
        prefix: t.prefix,
        createdAt: t.createdAt.toISOString(),
        revokedAt: t.revokedAt ? t.revokedAt.toISOString() : null,
      })),
    }
  })

  // POST /api/tokens — create a token (also upserts the project)
  app.post('/api/tokens', async (request, reply) => {
    if (!request.auth) {
      reply.code(401)
      return { error: 'unauthenticated' }
    }
    const parsed = createTokenBodySchema.safeParse(request.body)
    if (!parsed.success) {
      reply.code(400)
      return { error: 'invalid_input', issues: parsed.error.issues }
    }
    const created = await createTokenForProject(deps.db, {
      orgId: request.auth.user.orgId,
      projectName: parsed.data.projectName,
      tokenName: parsed.data.tokenName,
    })
    const { user } = request.auth
    await app.withTenantTx(user.orgId, (trx) =>
      auditRecord(trx, {
        eventType: 'token_create',
        actorUserId: user.id,
        targetKind: 'ingest_token',
        targetId: created.id,
        metadata: {
          project: parsed.data.projectName,
          name: created.name,
          prefix: created.prefix,
        },
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      }),
    )
    return {
      token: created.token,
      record: {
        id: created.id,
        projectId: created.projectId,
        name: created.name,
        prefix: created.prefix,
        createdAt: created.createdAt.toISOString(),
      },
    }
  })

  // DELETE /api/tokens/:id — revoke
  app.delete<{ Params: { id: string } }>('/api/tokens/:id', async (request, reply) => {
    if (!request.auth) {
      reply.code(401)
      return { error: 'unauthenticated' }
    }
    const ok = await revokeToken(deps.db, {
      orgId: request.auth.user.orgId,
      tokenId: request.params.id,
    })
    if (!ok) {
      reply.code(404)
      return { error: 'not_found' }
    }
    const { user } = request.auth
    await app.withTenantTx(user.orgId, (trx) =>
      auditRecord(trx, {
        eventType: 'token_revoke',
        actorUserId: user.id,
        targetKind: 'ingest_token',
        targetId: request.params.id,
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      }),
    )
    return { ok: true }
  })
}
