import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify'
import type { Kysely } from 'kysely'
import type { DB } from '../../db/schema.js'
import { findUserById, getLocalDefaultUser } from './dao.js'
import { verifyJwt } from './jwt.js'

export interface AuthMiddlewareDeps {
  db: Kysely<DB>
  mode: 'local' | 'multi-tenant'
  cookieName: string
  jwtSecret: string
}

export function resolveAuthContext(deps: AuthMiddlewareDeps): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (deps.mode === 'local') {
      const user = await getLocalDefaultUser(deps.db)
      request.auth = {
        user: {
          id: user.id,
          email: user.email,
          orgId: user.orgId,
          emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
        },
      }
      return
    }

    const cookieValue = request.cookies?.[deps.cookieName]
    if (!cookieValue) {
      reply.code(401)
      throw new Error('unauthenticated')
    }

    const payload = verifyJwt(cookieValue, deps.jwtSecret)
    if (!payload) {
      reply.code(401)
      throw new Error('unauthenticated')
    }

    const user = await findUserById(deps.db, payload.userId)
    if (!user) {
      reply.code(401)
      throw new Error('unauthenticated')
    }
    if (user.passwordVersion !== payload.pv) {
      reply.code(401)
      throw new Error('unauthenticated')
    }

    request.auth = {
      user: {
        id: user.id,
        email: user.email,
        orgId: user.orgId,
        emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
      },
    }
  }
}
