import { afterAll, beforeEach, describe, expect, it, test } from 'vitest'
import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import { createAppRoleTestDb, createTestDb, truncateAll } from '../helpers/db.js'
import { authRoutes } from '../../src/modules/auth/routes.js'
import { resolveAuthContext } from '../../src/modules/auth/middleware.js'
import { dbTenantPlugin } from '../../src/modules/db-tenant/index.js'
import { MockEmailSender } from '../../src/modules/email/index.js'

const SECRET = 'test-secret-xxxxxxxxxxxxxxxxxxxxxxxxxxxx'
const COOKIE = 'argus_session'

describe('auth routes', () => {
  const db = createTestDb()
  const appDb = createAppRoleTestDb()

  beforeEach(async () => {
    await truncateAll(db)
  })

  afterAll(async () => {
    await db.destroy()
    await appDb.destroy()
  })

  async function makeApp(): Promise<{ app: ReturnType<typeof Fastify>; sender: MockEmailSender }> {
    const app = Fastify()
    await app.register(cookie)
    await app.register(dbTenantPlugin, { db: appDb })
    const sender = new MockEmailSender()
    const authMiddleware = resolveAuthContext({
      db,
      mode: 'multi-tenant',
      cookieName: COOKIE,
      jwtSecret: SECRET,
    })
    await app.register(authRoutes, {
      db,
      cookieName: COOKIE,
      jwtSecret: SECRET,
      cookieSecure: false,
      sessionTtlSeconds: 3600,
      authMiddleware,
      emailSender: sender,
      appBaseUrl: 'http://localhost:5173',
    })
    return { app, sender }
  }

  it('POST /auth/register creates a user, returns the user, sets cookie', async () => {
    const { app } = await makeApp()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'alice@example.com', password: 'pw-at-least-8' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { user: { id: string; email: string; orgId: string } }
    expect(body.user.email).toBe('alice@example.com')
    expect(body.user.orgId).toMatch(/^[0-9a-f-]{36}$/)
    const setCookie = res.headers['set-cookie']
    expect(setCookie).toBeDefined()
    expect(String(setCookie)).toContain(`${COOKIE}=`)
    await app.close()
  })

  it('POST /auth/register returns 409 when email already exists', async () => {
    const { app } = await makeApp()
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'dup@example.com', password: 'pw-at-least-8' },
    })
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'dup@example.com', password: 'pw-at-least-8' },
    })
    expect(res.statusCode).toBe(409)
    await app.close()
  })

  it('POST /auth/login with correct credentials returns 200 + sets cookie', async () => {
    const { app } = await makeApp()
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'bob@example.com', password: 'pw-at-least-8' },
    })
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'bob@example.com', password: 'pw-at-least-8' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ user: { email: 'bob@example.com' } })
    await app.close()
  })

  it('POST /auth/login returns 401 with wrong password', async () => {
    const { app } = await makeApp()
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'c@example.com', password: 'pw-at-least-8' },
    })
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'c@example.com', password: 'wrong-pw-here' },
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('POST /auth/logout clears the cookie', async () => {
    const { app } = await makeApp()
    const res = await app.inject({ method: 'POST', url: '/auth/logout' })
    expect(res.statusCode).toBe(200)
    const setCookie = String(res.headers['set-cookie'])
    expect(setCookie).toContain(`${COOKIE}=`)
    expect(setCookie.toLowerCase()).toContain('max-age=0')
    await app.close()
  })

  test('successful register inserts a register audit row', async () => {
    const { app } = await makeApp()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'new@a.com', password: 'password123' },
    })
    expect(res.statusCode).toBe(200)
    const rows = await db.selectFrom('audit_log').selectAll().execute()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.event_type).toBe('register')
    expect(rows[0]!.metadata).toEqual({ method: 'register' })
    await app.close()
  })

  test('successful login inserts a login_success row', async () => {
    const { app } = await makeApp()
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'log@a.com', password: 'password123' },
    })
    await db.deleteFrom('audit_log').execute() // clear register row
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'log@a.com', password: 'password123' },
    })
    expect(res.statusCode).toBe(200)
    const rows = await db.selectFrom('audit_log').selectAll().execute()
    expect(rows).toHaveLength(1)
    expect(rows[0]!.event_type).toBe('login_success')
    await app.close()
  })

  test('failed login does NOT insert into audit_log', async () => {
    const { app } = await makeApp()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'nobody@a.com', password: 'wrongpassword' },
    })
    expect(res.statusCode).toBe(401)
    const rows = await db.selectFrom('audit_log').selectAll().execute()
    expect(rows).toHaveLength(0)
    await app.close()
  })

  test('register fires a verification email', async () => {
    const { app, sender } = await makeApp()
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'new@test.com', password: 'password123' },
    })
    const verifyMsgs = sender.sent.filter((m) => m.subject.includes('Verify'))
    expect(verifyMsgs).toHaveLength(1)
    expect(verifyMsgs[0]!.to).toBe('new@test.com')
    await app.close()
  })

  test('register still returns 200 when email send throws', async () => {
    const { app, sender } = await makeApp()
    sender.throwOnSend = true
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'throws@test.com', password: 'password123' },
    })
    expect(res.statusCode).toBe(200)
    await app.close()
  })

  test('GET /auth/me — exposes emailVerifiedAt', async () => {
    const { app } = await makeApp()
    const reg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'me@test.com', password: 'password123' },
    })
    const c = reg.cookies[0]!
    const me = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { cookie: `${c.name}=${c.value}` },
    })
    expect(me.statusCode).toBe(200)
    const body = JSON.parse(me.body) as {
      user: { id: string; email: string; orgId: string; emailVerifiedAt: string | null }
    }
    expect(body.user.emailVerifiedAt).toBeNull()
    await app.close()
  })
})
