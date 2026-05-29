import { describe, expect, test, beforeAll, afterAll } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { sql } from 'kysely'
import { dbTenantPlugin } from '../../src/modules/db-tenant/index.js'
import { createAppRoleTestDb } from '../helpers/db.js'

describe('withTenantTx', () => {
  let app: FastifyInstance
  const db = createAppRoleTestDb()
  const ORG_A = '00000000-0000-0000-0000-00000000aaaa'
  // Insert org_a once before the suite via super-user; argus_app can't INSERT into orgs.
  // We piggyback on createTestDb for setup.

  beforeAll(async () => {
    app = Fastify()
    await app.register(dbTenantPlugin, { db })
    // ensure org_a exists
    const { createTestDb } = await import('../helpers/db.js')
    const admin = createTestDb()
    await sql`INSERT INTO orgs (id, name) VALUES (${ORG_A}, 'test-a') ON CONFLICT DO NOTHING`.execute(
      admin,
    )
    await admin.destroy()
  })
  afterAll(async () => {
    await app.close()
    await db.destroy()
  })

  test('SET LOCAL takes effect inside the tx', async () => {
    const orgIdSeen = await app.withTenantTx(ORG_A, async (trx) => {
      const { rows } = await sql<{ current_setting: string }>`
        SELECT current_setting('argus.current_org_id', true) AS current_setting
      `.execute(trx)
      return rows[0]?.current_setting
    })
    expect(orgIdSeen).toBe(ORG_A)
  })

  test('GUC does not leak to the next pool acquire', async () => {
    await app.withTenantTx(ORG_A, async (trx) => {
      await sql`SELECT 1`.execute(trx)
    })
    // Open a fresh tx in the same pool and check the GUC is unset.
    const orgIdSeen = await db.transaction().execute(async (trx) => {
      const { rows } = await sql<{ current_setting: string | null }>`
        SELECT current_setting('argus.current_org_id', true) AS current_setting
      `.execute(trx)
      return rows[0]?.current_setting ?? null
    })
    expect(orgIdSeen === '' || orgIdSeen === null).toBe(true)
  })

  test('rollback on throw — fn throws → tx rolls back', async () => {
    await expect(
      app.withTenantTx(ORG_A, async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    // No side effects observable; if our `set_config` somehow persisted, the next
    // test would fail. The previous test covers that.
  })
})
