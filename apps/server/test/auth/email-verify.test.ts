import { describe, expect, test, beforeAll, afterAll, beforeEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import {
  authRoutes,
  resolveAuthContext,
  type AuthMiddlewareDeps,
} from '../../src/modules/auth/index.js'
import { dbTenantPlugin } from '../../src/modules/db-tenant/index.js'
import { MockEmailSender } from '../../src/modules/email/index.js'
import { createTestDb, createAppRoleTestDb, truncateAll } from '../helpers/db.js'

const JWT_SECRET = 'test-secret-at-least-32-chars-long-x'

describe('email verify routes', () => {
  let app: FastifyInstance
  const admin = createTestDb()
  const appDb = createAppRoleTestDb()
  let sender: MockEmailSender

  beforeAll(async () => {
    app = Fastify()
    await app.register(cookie)
    await app.register(dbTenantPlugin, { db: appDb })
    sender = new MockEmailSender()
    const authDeps: AuthMiddlewareDeps = {
      db: appDb,
      mode: 'multi-tenant',
      cookieName: 'argus_session',
      jwtSecret: JWT_SECRET,
    }
    const authMiddleware = resolveAuthContext(authDeps)
    await app.register(authRoutes, {
      db: appDb,
      cookieName: 'argus_session',
      jwtSecret: JWT_SECRET,
      cookieSecure: false,
      sessionTtlSeconds: 3600,
      authMiddleware,
      emailSender: sender,
      appBaseUrl: 'http://localhost:5173',
    })
  })
  beforeEach(async () => {
    await truncateAll(admin)
    sender.sent.length = 0
    sender.throwOnSend = false
  })
  afterAll(async () => {
    await app.close()
    await appDb.destroy()
    await admin.destroy()
  })

  async function registerAndCookie(email: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password: 'password123' },
    })
    expect(res.statusCode).toBe(200)
    // Register fires a verify email; clear the rate-limit-blocking token so
    // subsequent /auth/email-verify/request calls in this test aren't throttled.
    await admin.deleteFrom('auth_one_time_tokens').execute()
    sender.sent.length = 0
    const c = res.cookies[0]!
    return `${c.name}=${c.value}`
  }

  test('POST /auth/email-verify/request — emits one email', async () => {
    const cookie = await registerAndCookie('v1@test.com')
    sender.sent.length = 0
    const res = await app.inject({
      method: 'POST',
      url: '/auth/email-verify/request',
      headers: { cookie },
    })
    expect(res.statusCode).toBe(200)
    expect(sender.sent).toHaveLength(1)
    expect(sender.sent[0]!.to).toBe('v1@test.com')
  })

  test('POST /auth/email-verify/request — second call within 60s returns 200 but no email', async () => {
    const cookie = await registerAndCookie('v2@test.com')
    sender.sent.length = 0
    await app.inject({ method: 'POST', url: '/auth/email-verify/request', headers: { cookie } })
    await app.inject({ method: 'POST', url: '/auth/email-verify/request', headers: { cookie } })
    expect(sender.sent).toHaveLength(1)
  })

  test('POST /auth/email-verify/request — 401 when unauthenticated', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/email-verify/request' })
    expect(res.statusCode).toBe(401)
  })

  test('POST /auth/email-verify/confirm — valid token marks user verified', async () => {
    const cookie = await registerAndCookie('v3@test.com')
    sender.sent.length = 0
    await app.inject({ method: 'POST', url: '/auth/email-verify/request', headers: { cookie } })
    const url = sender.sent[0]!.text.match(/http[^\s]+/)![0]
    const token = new URL(url).searchParams.get('token')!
    const res = await app.inject({
      method: 'POST',
      url: '/auth/email-verify/confirm',
      payload: { token },
    })
    expect(res.statusCode).toBe(200)
    const u = await admin
      .selectFrom('users')
      .where('email', '=', 'v3@test.com')
      .select(['email_verified_at'])
      .executeTakeFirst()
    expect(u?.email_verified_at).not.toBeNull()
  })

  test('POST /auth/email-verify/confirm — invalid token returns 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/email-verify/confirm',
      payload: { token: 'verify_garbage' },
    })
    expect(res.statusCode).toBe(400)
  })

  test('POST /auth/email-verify/confirm — same token used twice returns 400 on second', async () => {
    const cookie = await registerAndCookie('v4@test.com')
    sender.sent.length = 0
    await app.inject({ method: 'POST', url: '/auth/email-verify/request', headers: { cookie } })
    const token = new URL(sender.sent[0]!.text.match(/http[^\s]+/)![0]).searchParams.get('token')!
    const first = await app.inject({
      method: 'POST',
      url: '/auth/email-verify/confirm',
      payload: { token },
    })
    expect(first.statusCode).toBe(200)
    const second = await app.inject({
      method: 'POST',
      url: '/auth/email-verify/confirm',
      payload: { token },
    })
    expect(second.statusCode).toBe(400)
  })
})
