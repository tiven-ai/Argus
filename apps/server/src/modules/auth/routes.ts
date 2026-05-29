import type { FastifyInstance, FastifyPluginAsync, FastifyReply } from 'fastify'
import type { Kysely } from 'kysely'
import { z } from 'zod'
import type { DB } from '../../db/schema.js'
import { createUser, findUserByEmail } from './dao.js'
import { hashPassword, verifyPassword } from './password.js'
import { signJwt } from './jwt.js'

export interface AuthRoutesDeps {
  db: Kysely<DB>
  cookieName: string
  jwtSecret: string
  cookieSecure: boolean
  sessionTtlSeconds: number
}

const registerBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
})

const loginBodySchema = registerBodySchema

function setSessionCookie(reply: FastifyReply, deps: AuthRoutesDeps, userId: string) {
  const token = signJwt({ userId }, deps.jwtSecret, deps.sessionTtlSeconds)
  reply.setCookie(deps.cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: deps.cookieSecure,
    path: '/',
    maxAge: deps.sessionTtlSeconds,
  })
}

function clearSessionCookie(reply: FastifyReply, deps: AuthRoutesDeps) {
  reply.setCookie(deps.cookieName, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: deps.cookieSecure,
    path: '/',
    maxAge: 0,
  })
}

export const authRoutes: FastifyPluginAsync<AuthRoutesDeps> = async (
  app: FastifyInstance,
  deps,
) => {
  app.post('/auth/register', async (request, reply) => {
    const parsed = registerBodySchema.safeParse(request.body)
    if (!parsed.success) {
      reply.code(400)
      return { error: 'invalid_input', issues: parsed.error.issues }
    }
    const { email, password } = parsed.data

    const existing = await findUserByEmail(deps.db, email)
    if (existing) {
      reply.code(409)
      return { error: 'email_already_registered' }
    }

    const passwordHash = await hashPassword(password)
    const record = await createUser(deps.db, { email, passwordHash, orgName: '' })
    setSessionCookie(reply, deps, record.id)
    return { user: { id: record.id, email: record.email, orgId: record.orgId } }
  })

  app.post('/auth/login', async (request, reply) => {
    const parsed = loginBodySchema.safeParse(request.body)
    if (!parsed.success) {
      reply.code(400)
      return { error: 'invalid_input', issues: parsed.error.issues }
    }
    const { email, password } = parsed.data

    const record = await findUserByEmail(deps.db, email)
    if (!record) {
      reply.code(401)
      return { error: 'invalid_credentials' }
    }
    const ok = await verifyPassword(password, record.passwordHash)
    if (!ok) {
      reply.code(401)
      return { error: 'invalid_credentials' }
    }

    setSessionCookie(reply, deps, record.id)
    return { user: { id: record.id, email: record.email, orgId: record.orgId } }
  })

  app.post('/auth/logout', async (_request, reply) => {
    clearSessionCookie(reply, deps)
    return { ok: true }
  })

  app.get('/auth/me', async (request, reply) => {
    if (!request.auth) {
      reply.code(401)
      return { error: 'unauthenticated' }
    }
    return { user: request.auth.user }
  })
}
