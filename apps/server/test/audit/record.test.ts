import { describe, expect, test, beforeAll, afterAll, beforeEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { sql } from 'kysely'
import { dbTenantPlugin } from '../../src/modules/db-tenant/index.js'
import { record } from '../../src/modules/audit/index.js'
import { createAppRoleTestDb, createTestDb, truncateAll } from '../helpers/db.js'

const ORG_A = '00000000-0000-0000-0000-00000000aaaa'
const USER_A = '00000000-0000-0000-0000-00000000aaab'

describe('audit.record', () => {
  let app: FastifyInstance
  const appDb = createAppRoleTestDb()
  const admin = createTestDb()

  beforeAll(async () => {
    app = Fastify()
    await app.register(dbTenantPlugin, { db: appDb })
  })
  beforeEach(async () => {
    await truncateAll(admin)
    await sql`INSERT INTO orgs (id, name) VALUES (${ORG_A}, 'a')`.execute(admin)
    await sql`INSERT INTO users (id, email, password_hash) VALUES (${USER_A}, 'a@a.com', 'x')`.execute(
      admin,
    )
  })
  afterAll(async () => {
    await app.close()
    await appDb.destroy()
    await admin.destroy()
  })

  test('inserts a row with all fields when set', async () => {
    await app.withTenantTx(ORG_A, async (trx) => {
      await record(trx, {
        eventType: 'token_create',
        actorUserId: USER_A,
        targetKind: 'ingest_token',
        targetId: '11111111-1111-1111-1111-111111111111',
        metadata: { project: 'pA', name: 'prod', prefix: 'argus_a' },
        ip: '127.0.0.1',
        userAgent: 'vitest/1.0',
      })
    })
    const rows = await admin.selectFrom('audit_log').selectAll().execute()
    expect(rows).toHaveLength(1)
    const r = rows[0]
    expect(r.org_id).toBe(ORG_A)
    expect(r.actor_user_id).toBe(USER_A)
    expect(r.event_type).toBe('token_create')
    expect(r.target_kind).toBe('ingest_token')
    expect(r.metadata).toEqual({ project: 'pA', name: 'prod', prefix: 'argus_a' })
    expect(r.ip).toBe('127.0.0.1')
    expect(r.user_agent).toBe('vitest/1.0')
  })

  test('accepts null actor + minimal args', async () => {
    await app.withTenantTx(ORG_A, async (trx) => {
      await record(trx, { eventType: 'register', actorUserId: USER_A })
    })
    const rows = await admin.selectFrom('audit_log').selectAll().execute()
    expect(rows).toHaveLength(1)
    expect(rows[0].target_kind).toBeNull()
    expect(rows[0].metadata).toBeNull()
    expect(rows[0].ip).toBeNull()
    expect(rows[0].user_agent).toBeNull()
  })

  test('throws when called without active GUC (outside withTenantTx)', async () => {
    await expect(
      appDb.transaction().execute(async (trx) => {
        await record(trx, { eventType: 'register', actorUserId: USER_A })
      }),
    ).rejects.toThrow(/argus.current_org_id|unrecognized configuration parameter/)
  })

  test('truncates user_agent at 2048 chars', async () => {
    const longUa = 'a'.repeat(3000)
    await app.withTenantTx(ORG_A, async (trx) => {
      await record(trx, { eventType: 'login_success', actorUserId: USER_A, userAgent: longUa })
    })
    const rows = await admin.selectFrom('audit_log').selectAll().execute()
    expect(rows[0].user_agent?.length).toBe(2048)
  })
})
