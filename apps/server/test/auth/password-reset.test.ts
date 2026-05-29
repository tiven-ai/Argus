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

describe('password reset routes', () => {
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

  async function register(email: string): Promise<void> {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password: 'password123' },
    })
    expect(res.statusCode).toBe(200)
  }

  test('POST /auth/password-reset/request — returns 200 for unknown email, no email sent', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/password-reset/request',
      payload: { email: 'noone@test.com' },
    })
    expect(res.statusCode).toBe(200)
    expect(sender.sent.filter((m) => m.subject.startsWith('Reset'))).toHaveLength(0)
  })

  test('POST /auth/password-reset/request — known user → one reset email', async () => {
    await register('r1@test.com')
    sender.sent.length = 0
    const res = await app.inject({
      method: 'POST',
      url: '/auth/password-reset/request',
      payload: { email: 'r1@test.com' },
    })
    expect(res.statusCode).toBe(200)
    const resetMsgs = sender.sent.filter((m) => m.subject.includes('Reset'))
    expect(resetMsgs).toHaveLength(1)
  })

  test('POST /auth/password-reset/confirm — happy path: new password works for login', async () => {
    await register('r2@test.com')
    sender.sent.length = 0
    await app.inject({
      method: 'POST',
      url: '/auth/password-reset/request',
      payload: { email: 'r2@test.com' },
    })
    const token = new URL(
      sender.sent.find((m) => m.subject.includes('Reset'))!.text.match(/http[^\s]+/)![0],
    ).searchParams.get('token')!
    const res = await app.inject({
      method: 'POST',
      url: '/auth/password-reset/confirm',
      payload: { token, newPassword: 'newpassword99' },
    })
    expect(res.statusCode).toBe(200)
    // Login with new pwd should succeed:
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'r2@test.com', password: 'newpassword99' },
    })
    expect(login.statusCode).toBe(200)
    // Login with old pwd should fail:
    const old = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'r2@test.com', password: 'password123' },
    })
    expect(old.statusCode).toBe(401)
  })

  test('POST /auth/password-reset/confirm — invalid token returns 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/password-reset/confirm',
      payload: { token: 'reset_garbage', newPassword: 'newpassword99' },
    })
    expect(res.statusCode).toBe(400)
  })

  test('POST /auth/password-reset/confirm — sends courtesy passwordChanged email', async () => {
    await register('r3@test.com')
    sender.sent.length = 0
    await app.inject({
      method: 'POST',
      url: '/auth/password-reset/request',
      payload: { email: 'r3@test.com' },
    })
    const token = new URL(
      sender.sent.find((m) => m.subject.includes('Reset'))!.text.match(/http[^\s]+/)![0],
    ).searchParams.get('token')!
    sender.sent.length = 0
    await app.inject({
      method: 'POST',
      url: '/auth/password-reset/confirm',
      payload: { token, newPassword: 'newpassword99' },
    })
    expect(sender.sent.find((m) => m.subject.includes('changed'))).toBeDefined()
  })

  test('POST /auth/password-reset/confirm — also revokes pending email-verify token', async () => {
    await register('r4@test.com')
    sender.sent.length = 0
    // Issue an email-verify token first.
    await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'r4@test.com', password: 'password123' },
    })
    const loginCookie = (
      await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'r4@test.com', password: 'password123' },
      })
    ).cookies[0]!
    sender.sent.length = 0
    await app.inject({
      method: 'POST',
      url: '/auth/email-verify/request',
      headers: { cookie: `${loginCookie.name}=${loginCookie.value}` },
    })
    const verifyToken = new URL(
      sender.sent.find((m) => m.subject.includes('Verify'))!.text.match(/http[^\s]+/)![0],
    ).searchParams.get('token')!
    // Now run reset request + confirm.
    sender.sent.length = 0
    await app.inject({
      method: 'POST',
      url: '/auth/password-reset/request',
      payload: { email: 'r4@test.com' },
    })
    const resetToken = new URL(
      sender.sent.find((m) => m.subject.includes('Reset'))!.text.match(/http[^\s]+/)![0],
    ).searchParams.get('token')!
    await app.inject({
      method: 'POST',
      url: '/auth/password-reset/confirm',
      payload: { token: resetToken, newPassword: 'newpassword99' },
    })
    // The previously issued verify token should now be unusable.
    const reuse = await app.inject({
      method: 'POST',
      url: '/auth/email-verify/confirm',
      payload: { token: verifyToken },
    })
    expect(reuse.statusCode).toBe(400)
  })
})
