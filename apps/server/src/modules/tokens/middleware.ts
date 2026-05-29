import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify'
import type { Kysely } from 'kysely'
import type { DB } from '../../db/schema.js'
import { DEFAULT_ORG_ID } from '../../constants.js'
import { parseAuthHeader } from './helpers.js'
import { resolveTokenContext, type ResolvedTokenContext } from './dao.js'

export interface IngestContext {
  orgId: string
  /** Optional — when provided by a token, ingest can constrain project. */
  projectId?: string
  projectName?: string
}

declare module 'fastify' {
  interface FastifyRequest {
    ingest?: IngestContext
  }
}

export interface TokenMiddlewareDeps {
  db: Kysely<DB>
  mode: 'local' | 'multi-tenant'
}

export function resolveIngestContext(deps: TokenMiddlewareDeps): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (deps.mode === 'local') {
      request.ingest = { orgId: DEFAULT_ORG_ID }
      return
    }

    const headerToken = parseAuthHeader(request.headers.authorization)
    if (!headerToken) {
      reply.code(401)
      throw new Error('missing_ingest_token')
    }

    const ctx = await resolveTokenContext(deps.db, headerToken)
    if (!ctx) {
      reply.code(401)
      throw new Error('invalid_ingest_token')
    }

    request.ingest = makeIngestContext(ctx)
  }
}

function makeIngestContext(ctx: ResolvedTokenContext): IngestContext {
  return { orgId: ctx.orgId, projectId: ctx.projectId, projectName: ctx.projectName }
}
