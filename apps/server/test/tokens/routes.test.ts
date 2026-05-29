import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { createTestDb, truncateAll } from '../helpers/db.js'
import { dbTenantPlugin } from '../../src/modules/db-tenant/index.js'
import { tokenManagementRoutes } from '../../src/modules/tokens/routes.js'
import { createUser } from '../../src/modules/auth/dao.js'
import { hashPassword } from '../../src/modules/auth/password.js'

describe('token management routes', () => {
  const db = createTestDb()

  beforeEach(async () => {
    await truncateAll(db)
  })

  afterAll(async () => {
    await db.destroy()
  })

  async function makeApp(orgId: string | null, userId = 'u') {
    const app = Fastify()
    await app.register(dbTenantPlugin, { db })
    app.addHook('preHandler', async (req) => {
      if (orgId) req.auth = { user: { id: userId, email: 'e', orgId, emailVerifiedAt: null } }
    })
    await app.register(tokenManagementRoutes, { db })
    return app
  }

  it('GET /api/tokens returns 401 without auth', async () => {
    const app = await makeApp(null)
    const res = await app.inject({ method: 'GET', url: '/api/tokens' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('POST /api/tokens creates a token + returns it once', async () => {
    const u = await createUser(db, {
      email: 'a@example.com',
      passwordHash: await hashPassword('pwpwpwpw'),
      orgName: 'org',
    })
    const app = await makeApp(u.orgId, u.id)
    const res = await app.inject({
      method: 'POST',
      url: '/api/tokens',
      payload: { projectName: 'p1', tokenName: 'first' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { token: string; record: { id: string; prefix: string } }
    expect(body.token).toMatch(/^argus_[0-9a-f]{32}$/)
    expect(body.record.prefix).toBe(body.token.slice(0, 12))

    // audit_log should have a token_create row for this org + user.
    const audit = await db
      .selectFrom('audit_log')
      .selectAll()
      .where('org_id', '=', u.orgId)
      .where('event_type', '=', 'token_create')
      .execute()
    expect(audit).toHaveLength(1)
    expect(audit[0]?.actor_user_id).toBe(u.id)
    expect(audit[0]?.target_kind).toBe('ingest_token')
    expect(audit[0]?.target_id).toBe(body.record.id)
    expect(audit[0]?.metadata).toEqual({
      project: 'p1',
      name: 'first',
      prefix: body.record.prefix,
    })
    await app.close()
  })

  it('GET /api/tokens lists tokens after creation', async () => {
    const u = await createUser(db, {
      email: 'b@example.com',
      passwordHash: await hashPassword('pwpwpwpw'),
      orgName: 'org',
    })
    const app = await makeApp(u.orgId, u.id)
    await app.inject({
      method: 'POST',
      url: '/api/tokens',
      payload: { projectName: 'p1', tokenName: 'first' },
    })
    const res = await app.inject({ method: 'GET', url: '/api/tokens' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { tokens: Array<{ name: string }> }
    expect(body.tokens).toHaveLength(1)
    expect(body.tokens[0]?.name).toBe('first')
    await app.close()
  })

  it('DELETE /api/tokens/:id revokes a token', async () => {
    const u = await createUser(db, {
      email: 'c@example.com',
      passwordHash: await hashPassword('pwpwpwpw'),
      orgName: 'org',
    })
    const app = await makeApp(u.orgId, u.id)
    const created = (await app
      .inject({
        method: 'POST',
        url: '/api/tokens',
        payload: { projectName: 'p1', tokenName: 'first' },
      })
      .then((r) => r.json())) as { record: { id: string } }
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/tokens/${created.record.id}`,
    })
    expect(res.statusCode).toBe(200)

    const listRes = await app.inject({ method: 'GET', url: '/api/tokens' })
    const list = listRes.json() as { tokens: Array<{ revokedAt: string | null }> }
    expect(list.tokens[0]?.revokedAt).not.toBeNull()

    // audit_log should have a token_revoke row for this org + user + token.
    const audit = await db
      .selectFrom('audit_log')
      .selectAll()
      .where('org_id', '=', u.orgId)
      .where('event_type', '=', 'token_revoke')
      .execute()
    expect(audit).toHaveLength(1)
    expect(audit[0]?.actor_user_id).toBe(u.id)
    expect(audit[0]?.target_kind).toBe('ingest_token')
    expect(audit[0]?.target_id).toBe(created.record.id)
    await app.close()
  })

  it('DELETE returns 404 for a token belonging to a different org', async () => {
    const a = await createUser(db, {
      email: 'x@example.com',
      passwordHash: await hashPassword('pwpwpwpw'),
      orgName: 'org-a',
    })
    const b = await createUser(db, {
      email: 'y@example.com',
      passwordHash: await hashPassword('pwpwpwpw'),
      orgName: 'org-b',
    })
    const appA = await makeApp(a.orgId, a.id)
    const tokenRes = await appA.inject({
      method: 'POST',
      url: '/api/tokens',
      payload: { projectName: 'p1', tokenName: 't' },
    })
    const aTokenId = (tokenRes.json() as { record: { id: string } }).record.id
    await appA.close()

    const appB = await makeApp(b.orgId, b.id)
    const res = await appB.inject({ method: 'DELETE', url: `/api/tokens/${aTokenId}` })
    expect(res.statusCode).toBe(404)
    await appB.close()
  })
})
