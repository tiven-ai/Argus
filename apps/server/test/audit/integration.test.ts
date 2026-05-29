import { describe, expect, test, beforeAll, afterAll, beforeEach } from 'vitest'
import { createServer, type ServerOptions } from '../../src/server.js'
import type { ArgusServer } from '../../src/server.js'
import { createTestDb, truncateAll } from '../helpers/db.js'

function appUrl(adminUrl: string): string {
  const u = new URL(adminUrl)
  u.username = 'argus_app'
  u.password = 'argus_app_dev_pwd'
  return u.toString()
}

describe('audit log E2E', () => {
  let server: ArgusServer
  const admin = createTestDb()

  beforeAll(async () => {
    const opts: ServerOptions = {
      databaseUrl: process.env.DATABASE_URL!,
      appDatabaseUrl: appUrl(process.env.DATABASE_URL!),
      logLevel: 'warn',
      mode: 'multi-tenant',
      jwtSecret: 'test-secret-at-least-32-chars-long-x',
      cookieName: 'argus_session',
      appBaseUrl: 'http://localhost:5173',
    }
    server = await createServer(opts)
    await server.app.ready()
  })
  beforeEach(async () => {
    await truncateAll(admin)
  })
  afterAll(async () => {
    await server.app.close()
    await admin.destroy()
  })

  test('register → login → create token → revoke token writes 4 audit rows', async () => {
    // 1. Register
    let res = await server.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'e2e@a.com', password: 'password123' },
    })
    expect(res.statusCode).toBe(200)
    const cookie = res.cookies[0]
    expect(cookie).toBeDefined()

    // 2. Login (separate, to assert two distinct events)
    res = await server.app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'e2e@a.com', password: 'password123' },
    })
    expect(res.statusCode).toBe(200)
    const cookie2 = res.cookies[0]

    // 3. Create token
    res = await server.app.inject({
      method: 'POST',
      url: '/api/tokens',
      headers: { cookie: `${cookie2!.name}=${cookie2!.value}` },
      payload: { projectName: 'e2e-proj', tokenName: 'e2e-tok' },
    })
    expect(res.statusCode).toBe(200)
    const tokenId = JSON.parse(res.body).record.id

    // 4. Revoke
    res = await server.app.inject({
      method: 'DELETE',
      url: `/api/tokens/${tokenId}`,
      headers: { cookie: `${cookie2!.name}=${cookie2!.value}` },
    })
    expect(res.statusCode).toBe(200)

    const rows = await admin
      .selectFrom('audit_log')
      .selectAll()
      .orderBy('timestamp', 'asc')
      .execute()
    expect(rows.map((r) => r.event_type)).toEqual([
      'register',
      'login_success',
      'token_create',
      'token_revoke',
    ])
    expect(rows[2]!.target_kind).toBe('ingest_token')
    expect(rows[3]!.target_kind).toBe('ingest_token')
  })

  test('failed login does not insert', async () => {
    const res = await server.app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'never@a.com', password: 'wrongpassword' },
    })
    expect(res.statusCode).toBe(401)
    const rows = await admin.selectFrom('audit_log').selectAll().execute()
    expect(rows).toHaveLength(0)
  })
})
