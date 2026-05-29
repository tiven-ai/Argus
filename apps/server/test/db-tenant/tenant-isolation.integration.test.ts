import { describe, expect, test, beforeAll, afterAll, beforeEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { sql } from 'kysely'
import { dbTenantPlugin } from '../../src/modules/db-tenant/index.js'
import { createAppRoleTestDb, createTestDb, truncateAll } from '../helpers/db.js'

const ORG_A = '00000000-0000-0000-0000-00000000aaaa'
const ORG_B = '00000000-0000-0000-0000-00000000bbbb'
const PROJ_A = '00000000-0000-0000-0000-0000000000a1'
const PROJ_B = '00000000-0000-0000-0000-0000000000b1'

describe('tenant_isolation policy', () => {
  let app: FastifyInstance
  const appDb = createAppRoleTestDb()
  const admin = createTestDb()

  beforeAll(async () => {
    app = Fastify()
    await app.register(dbTenantPlugin, { db: appDb })
  })
  beforeEach(async () => {
    await truncateAll(admin)
    // Seed two orgs + one project each via super-user.
    await sql`INSERT INTO orgs (id, name) VALUES (${ORG_A}, 'a'), (${ORG_B}, 'b')`.execute(admin)
    await sql`
      INSERT INTO projects (id, org_id, name) VALUES (${PROJ_A}, ${ORG_A}, 'pA'), (${PROJ_B}, ${ORG_B}, 'pB')
    `.execute(admin)
  })
  afterAll(async () => {
    await app.close()
    await appDb.destroy()
    await admin.destroy()
  })

  test('argus_app sees zero rows on tenant tables without SET LOCAL', async () => {
    const rows = await appDb.selectFrom('projects').selectAll().execute()
    expect(rows).toHaveLength(0)
  })

  test('SET LOCAL to org A → only project A is visible', async () => {
    const rows = await app.withTenantTx(ORG_A, async (trx) =>
      trx.selectFrom('projects').selectAll().execute(),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.id).toBe(PROJ_A)
  })

  test('SET LOCAL to org B → only project B is visible', async () => {
    const rows = await app.withTenantTx(ORG_B, async (trx) =>
      trx.selectFrom('projects').selectAll().execute(),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.id).toBe(PROJ_B)
  })

  test('INSERT into org A while SET to org B raises RowSecurityViolation', async () => {
    await expect(
      app.withTenantTx(ORG_B, async (trx) =>
        trx
          .insertInto('projects')
          .values({ org_id: ORG_A, name: 'sneak' })
          .returning('id')
          .executeTakeFirstOrThrow(),
      ),
    ).rejects.toThrow(/row[- ]?level security|new row violates/i)
  })
})
