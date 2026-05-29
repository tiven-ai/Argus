import { describe, expect, test, beforeAll, afterAll, beforeEach } from 'vitest'
import { sql } from 'kysely'
import { cleanupOldAuditLogs } from '../../src/modules/audit/index.js'
import { createTestDb, truncateAll } from '../helpers/db.js'

const USER_A = '11111111-1111-1111-1111-111111111111'
const ORG_DEFAULT = '00000000-0000-0000-0000-000000000000'

describe('cleanupOldAuditLogs', () => {
  const db = createTestDb()
  beforeAll(async () => {
    // local user + default org are seeded by 0002.
  })
  beforeEach(async () => {
    await truncateAll(db)
  })
  afterAll(async () => {
    await db.destroy()
  })

  test('deletes rows older than retentionDays; keeps newer ones', async () => {
    // Three rows: 100 days, 31 days, 1 day old.
    await sql`
      INSERT INTO audit_log (org_id, actor_user_id, event_type, timestamp)
      VALUES
        (${ORG_DEFAULT}, ${USER_A}, 'login_success', now() - interval '100 days'),
        (${ORG_DEFAULT}, ${USER_A}, 'login_success', now() - interval '31 days'),
        (${ORG_DEFAULT}, ${USER_A}, 'login_success', now() - interval '1 day')
    `.execute(db)

    const result = await cleanupOldAuditLogs(db, 90)
    expect(result.deleted).toBe(1)
    const rows = await db.selectFrom('audit_log').selectAll().execute()
    expect(rows).toHaveLength(2)
  })

  test('retentionDays = 0 is a no-op', async () => {
    await sql`
      INSERT INTO audit_log (org_id, actor_user_id, event_type, timestamp)
      VALUES (${ORG_DEFAULT}, ${USER_A}, 'login_success', now() - interval '100 days')
    `.execute(db)
    const result = await cleanupOldAuditLogs(db, 0)
    expect(result.deleted).toBe(0)
    const rows = await db.selectFrom('audit_log').selectAll().execute()
    expect(rows).toHaveLength(1)
  })
})
