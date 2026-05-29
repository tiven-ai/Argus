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

describe('session revocation on password reset', () => {
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
  })
  afterAll(async () => {
    await app.close()
    await appDb.destroy()
    await admin.destroy()
  })

  test('old cookie returns 401 after password reset; new cookie works', async () => {
    // Register + capture cookie A.
    const reg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'revoke@test.com', password: 'oldpassword123' },
    })
    expect(reg.statusCode).toBe(200)
    const cookieA = reg.cookies[0]!
    const hdrA = `${cookieA.name}=${cookieA.value}`

    // Sanity: /auth/me works with cookie A.
    let me = await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie: hdrA } })
    expect(me.statusCode).toBe(200)

    // Request + confirm password reset.
    await app.inject({
      method: 'POST',
      url: '/auth/password-reset/request',
      payload: { email: 'revoke@test.com' },
    })
    const resetMsg = sender.sent.find((m) => m.subject.includes('Reset'))!
    const token = new URL(resetMsg.text.match(/http[^\s]+/)![0]).searchParams.get('token')!
    const confirm = await app.inject({
      method: 'POST',
      url: '/auth/password-reset/confirm',
      payload: { token, newPassword: 'newpassword99' },
    })
    expect(confirm.statusCode).toBe(200)

    // Cookie A should NOW be revoked.
    me = await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie: hdrA } })
    expect(me.statusCode).toBe(401)

    // Log in with the new password; cookie B works.
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'revoke@test.com', password: 'newpassword99' },
    })
    expect(login.statusCode).toBe(200)
    const cookieB = login.cookies[0]!
    const hdrB = `${cookieB.name}=${cookieB.value}`
    me = await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie: hdrB } })
    expect(me.statusCode).toBe(200)
    const body = JSON.parse(me.body)
    expect(body.user.email).toBe('revoke@test.com')
  })
})
