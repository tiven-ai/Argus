import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import { createTestDb, truncateAll } from '../helpers/db.js'
import { resolveAuthContext } from '../../src/modules/auth/middleware.js'
import { createUser } from '../../src/modules/auth/dao.js'
import { signJwt } from '../../src/modules/auth/jwt.js'
import { hashPassword } from '../../src/modules/auth/password.js'

const SECRET = 'test-secret-xxxxxxxxxxxxxxxxxxxxxxxxxxxx'
const COOKIE = 'argus_session'

describe('resolveAuthContext middleware', () => {
  const db = createTestDb()

  beforeEach(async () => {
    await truncateAll(db)
  })

  afterAll(async () => {
    await db.destroy()
  })

  async function makeApp(mode: 'local' | 'multi-tenant') {
    const app = Fastify()
    await app.register(cookie)
    app.addHook(
      'preHandler',
      resolveAuthContext({ db, mode, cookieName: COOKIE, jwtSecret: SECRET }),
    )
    app.get('/who', async (req) => req.auth?.user ?? null)
    return app
  }

  it('local mode authenticates every request as the default user', async () => {
    const app = await makeApp('local')
    const res = await app.inject({ method: 'GET', url: '/who' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      email: 'local@argus.dev',
      orgId: '00000000-0000-0000-0000-000000000000',
    })
    await app.close()
  })

  it('multi-tenant mode returns 401 without a cookie', async () => {
    const app = await makeApp('multi-tenant')
    const res = await app.inject({ method: 'GET', url: '/who' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('multi-tenant mode resolves a valid cookie to the user', async () => {
    const user = await createUser(db, {
      email: 'alice@example.com',
      passwordHash: await hashPassword('pw'),
      orgName: 'Alice workspace',
    })
    const token = signJwt({ userId: user.id, pv: user.passwordVersion }, SECRET, 3600)
    const app = await makeApp('multi-tenant')
    const res = await app.inject({
      method: 'GET',
      url: '/who',
      cookies: { [COOKIE]: token },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ email: 'alice@example.com', orgId: user.orgId })
    await app.close()
  })

  it('multi-tenant mode returns 401 for a tampered cookie', async () => {
    const app = await makeApp('multi-tenant')
    const res = await app.inject({
      method: 'GET',
      url: '/who',
      cookies: { [COOKIE]: 'not.a.real.jwt' },
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })
})
