import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { createTestDb, truncateAll } from '../helpers/db.js'
import { resolveIngestContext } from '../../src/modules/tokens/middleware.js'
import { createTokenForProject } from '../../src/modules/tokens/dao.js'
import { createUser } from '../../src/modules/auth/dao.js'
import { hashPassword } from '../../src/modules/auth/password.js'

describe('resolveIngestContext middleware', () => {
  const db = createTestDb()

  beforeEach(async () => {
    await truncateAll(db)
  })

  afterAll(async () => {
    await db.destroy()
  })

  async function makeApp(mode: 'local' | 'multi-tenant') {
    const app = Fastify()
    app.addHook('preHandler', resolveIngestContext({ db, mode }))
    app.post('/in', async (req) => req.ingest ?? null)
    return app
  }

  it('local mode auto-assigns the default org', async () => {
    const app = await makeApp('local')
    const res = await app.inject({ method: 'POST', url: '/in' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ orgId: '00000000-0000-0000-0000-000000000000' })
    await app.close()
  })

  it('multi-tenant mode returns 401 without a token', async () => {
    const app = await makeApp('multi-tenant')
    const res = await app.inject({ method: 'POST', url: '/in' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('multi-tenant mode resolves a valid bearer token to its org/project', async () => {
    const user = await createUser(db, {
      email: 'tk@example.com',
      passwordHash: await hashPassword('pwpwpwpw'),
      orgName: 'Tk org',
    })
    const created = await createTokenForProject(db, {
      orgId: user.orgId,
      projectName: 'proj1',
      tokenName: 'first token',
    })

    const app = await makeApp('multi-tenant')
    const res = await app.inject({
      method: 'POST',
      url: '/in',
      headers: { authorization: `Bearer ${created.token}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      orgId: user.orgId,
      projectId: created.projectId,
      projectName: 'proj1',
    })
    await app.close()
  })

  it('multi-tenant mode returns 401 for a revoked or unknown token', async () => {
    const app = await makeApp('multi-tenant')
    const res = await app.inject({
      method: 'POST',
      url: '/in',
      headers: { authorization: 'Bearer argus_nope' },
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })
})
