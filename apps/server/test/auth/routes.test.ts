import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import { createTestDb, truncateAll } from '../helpers/db.js'
import { authRoutes } from '../../src/modules/auth/routes.js'

const SECRET = 'test-secret-xxxxxxxxxxxxxxxxxxxxxxxxxxxx'
const COOKIE = 'argus_session'

describe('auth routes', () => {
  const db = createTestDb()

  beforeEach(async () => {
    await truncateAll(db)
  })

  afterAll(async () => {
    await db.destroy()
  })

  async function makeApp() {
    const app = Fastify()
    await app.register(cookie)
    await app.register(authRoutes, {
      db,
      cookieName: COOKIE,
      jwtSecret: SECRET,
      cookieSecure: false,
      sessionTtlSeconds: 3600,
      authMiddleware: async () => {},
    })
    return app
  }

  it('POST /auth/register creates a user, returns the user, sets cookie', async () => {
    const app = await makeApp()
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
    const app = await makeApp()
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
    const app = await makeApp()
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
    const app = await makeApp()
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
    const app = await makeApp()
    const res = await app.inject({ method: 'POST', url: '/auth/logout' })
    expect(res.statusCode).toBe(200)
    const setCookie = String(res.headers['set-cookie'])
    expect(setCookie).toContain(`${COOKIE}=`)
    expect(setCookie.toLowerCase()).toContain('max-age=0')
    await app.close()
  })
})
