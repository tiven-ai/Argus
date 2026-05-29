import type { FastifyInstance, FastifyPluginAsync, preHandlerHookHandler } from 'fastify'
import type { Kysely } from 'kysely'
import { z } from 'zod'
import type { DB } from '../../db/schema.js'
import { createUser, findUserByEmail } from './dao.js'
import { hashPassword, verifyPassword } from './password.js'
import { signJwt } from './jwt.js'
import { record as auditRecord } from '../audit/index.js'
import type { EmailSender } from '../email/index.js'
import {
  issueAndSendEmailVerify,
  issueAndSendPasswordReset,
  sendPasswordChanged,
} from './email-flows.js'
import { findActiveByRaw, findRateLimitBlockingToken } from '../auth-tokens/index.js'

export interface AuthRoutesDeps {
  db: Kysely<DB>
  cookieName: string
  jwtSecret: string
  cookieSecure: boolean
  sessionTtlSeconds: number
  /**
   * The same auth middleware applied to /api/* routes. /auth/me uses it so it
   * resolves `request.auth` whether the cookie is real (multi-tenant) or
   * synthetic (local mode).
   */
  authMiddleware: preHandlerHookHandler
  emailSender: EmailSender
  appBaseUrl: string
}

const registerBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
})

const loginBodySchema = registerBodySchema

const confirmBodySchema = z.object({ token: z.string().min(8) })

const resetRequestBodySchema = z.object({ email: z.string().email() })

const resetConfirmBodySchema = z.object({
  token: z.string().min(8),
  newPassword: z.string().min(8),
})

function setSessionCookie(
  reply: import('fastify').FastifyReply,
  deps: AuthRoutesDeps,
  userId: string,
) {
  const token = signJwt({ userId }, deps.jwtSecret, deps.sessionTtlSeconds)
  reply.setCookie(deps.cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: deps.cookieSecure,
    path: '/',
    maxAge: deps.sessionTtlSeconds,
  })
}

function clearSessionCookie(reply: import('fastify').FastifyReply, deps: AuthRoutesDeps) {
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
    await app.withTenantTx(record.orgId, (trx) =>
      auditRecord(trx, {
        eventType: 'register',
        actorUserId: record.id,
        metadata: { method: 'register' },
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      }),
    )
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
      request.log.warn(
        { event: 'login_failure', email, ip: request.ip, userAgent: request.headers['user-agent'] },
        'login_failure',
      )
      reply.code(401)
      return { error: 'invalid_credentials' }
    }
    const ok = await verifyPassword(password, record.passwordHash)
    if (!ok) {
      request.log.warn(
        { event: 'login_failure', email, ip: request.ip, userAgent: request.headers['user-agent'] },
        'login_failure',
      )
      reply.code(401)
      return { error: 'invalid_credentials' }
    }

    setSessionCookie(reply, deps, record.id)
    await app.withTenantTx(record.orgId, (trx) =>
      auditRecord(trx, {
        eventType: 'login_success',
        actorUserId: record.id,
        metadata: { method: 'cookie' },
        ip: request.ip,
        userAgent: request.headers['user-agent'],
      }),
    )
    return { user: { id: record.id, email: record.email, orgId: record.orgId } }
  })

  app.post('/auth/logout', async (_request, reply) => {
    clearSessionCookie(reply, deps)
    return { ok: true }
  })

  // /auth/me uses the same auth middleware as /api/* so it works in both
  // local (auto-default-user) and multi-tenant (cookie required) modes.
  app.get('/auth/me', { preHandler: deps.authMiddleware }, async (request, reply) => {
    if (!request.auth) {
      reply.code(401)
      return { error: 'unauthenticated' }
    }
    return { user: request.auth.user }
  })

  app.post(
    '/auth/email-verify/request',
    { preHandler: deps.authMiddleware },
    async (request, reply) => {
      if (!request.auth) {
        reply.code(401)
        return { error: 'unauthenticated' }
      }
      const userId = request.auth.user.id
      const email = request.auth.user.email
      const blocker = await findRateLimitBlockingToken(deps.db, userId, 'email_verify')
      if (blocker) {
        return { ok: true } // silent rate limit
      }
      try {
        await issueAndSendEmailVerify(
          { db: deps.db, emailSender: deps.emailSender, appBaseUrl: deps.appBaseUrl },
          { userId, email },
        )
      } catch (err) {
        request.log.warn(
          { err, event: 'email_send_failed', purpose: 'email_verify_request' },
          'email send failed',
        )
      }
      return { ok: true }
    },
  )

  app.post('/auth/email-verify/confirm', async (request, reply) => {
    const parsed = confirmBodySchema.safeParse(request.body)
    if (!parsed.success) {
      reply.code(400)
      return { error: 'invalid_input' }
    }
    const token = await findActiveByRaw(deps.db, parsed.data.token, 'email_verify')
    if (!token) {
      reply.code(400)
      return { error: 'invalid_or_expired_token' }
    }
    await deps.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('users')
        .set({ email_verified_at: new Date() })
        .where('id', '=', token.userId)
        .execute()
      await trx
        .updateTable('auth_one_time_tokens')
        .set({ consumed_at: new Date() })
        .where('id', '=', token.id)
        .execute()
    })
    return { ok: true }
  })

  app.post('/auth/password-reset/request', async (request, reply) => {
    const parsed = resetRequestBodySchema.safeParse(request.body)
    if (!parsed.success) {
      reply.code(400)
      return { error: 'invalid_input' }
    }
    const { email } = parsed.data
    const user = await findUserByEmail(deps.db, email)
    if (!user) {
      return { ok: true } // enumeration-safe
    }
    const blocker = await findRateLimitBlockingToken(deps.db, user.id, 'password_reset')
    if (blocker) {
      return { ok: true }
    }
    try {
      await issueAndSendPasswordReset(
        { db: deps.db, emailSender: deps.emailSender, appBaseUrl: deps.appBaseUrl },
        { userId: user.id, email },
      )
    } catch (err) {
      request.log.warn(
        { err, event: 'email_send_failed', purpose: 'password_reset_request' },
        'email send failed',
      )
    }
    return { ok: true }
  })

  app.post('/auth/password-reset/confirm', async (request, reply) => {
    const parsed = resetConfirmBodySchema.safeParse(request.body)
    if (!parsed.success) {
      reply.code(400)
      return { error: 'invalid_input', issues: parsed.error.issues }
    }
    const { token, newPassword } = parsed.data
    const found = await findActiveByRaw(deps.db, token, 'password_reset')
    if (!found) {
      reply.code(400)
      return { error: 'invalid_or_expired_token' }
    }
    const newHash = await hashPassword(newPassword)
    const userEmail = (
      await deps.db
        .selectFrom('users')
        .where('id', '=', found.userId)
        .select('email')
        .executeTakeFirstOrThrow()
    ).email
    await deps.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('users')
        .set({ password_hash: newHash })
        .where('id', '=', found.userId)
        .execute()
      await trx
        .updateTable('auth_one_time_tokens')
        .set({ consumed_at: new Date() })
        .where('id', '=', found.id)
        .execute()
      // Defense: revoke all unconsumed tokens of both kinds for this user.
      await trx
        .updateTable('auth_one_time_tokens')
        .set({ consumed_at: new Date() })
        .where('user_id', '=', found.userId)
        .where('consumed_at', 'is', null)
        .execute()
    })
    try {
      await sendPasswordChanged(
        { emailSender: deps.emailSender },
        { email: userEmail, at: new Date(), ip: request.ip },
      )
    } catch (err) {
      request.log.warn(
        { err, event: 'email_send_failed', purpose: 'password_changed_notification' },
        'email send failed',
      )
    }
    return { ok: true }
  })
}
