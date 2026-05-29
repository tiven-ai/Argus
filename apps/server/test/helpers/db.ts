import { sql, type Kysely } from 'kysely'
import type { DB } from '../../src/db/schema.js'
import { createKysely } from '../../src/db/kysely.js'

export function createTestDb(): Kysely<DB> {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL not set — global setup did not run')
  return createKysely(url)
}

export async function truncateAll(db: Kysely<DB>): Promise<void> {
  // Truncate all data tables. Preserve the default user + org + org_member
  // seeded by migration 0002 (other tests may rely on the local-mode default).
  await sql`TRUNCATE TABLE audit_log, step_events, steps, sessions, services, projects, ingest_tokens RESTART IDENTITY CASCADE`.execute(
    db,
  )
  await sql`DELETE FROM org_members WHERE user_id != '11111111-1111-1111-1111-111111111111'`.execute(
    db,
  )
  await sql`DELETE FROM users WHERE id != '11111111-1111-1111-1111-111111111111'`.execute(db)
  await sql`DELETE FROM orgs WHERE id != '00000000-0000-0000-0000-000000000000'`.execute(db)
}

/**
 * Return a Kysely connected as the `argus_app` runtime role (NO BYPASSRLS).
 * Created by migration 0003 with a known dev password. Tests that exercise
 * RLS / withTenantTx must use this instead of the super-user `createTestDb()`.
 */
export function createAppRoleTestDb(): Kysely<DB> {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL not set — global setup did not run')
  const u = new URL(url)
  u.username = 'argus_app'
  u.password = 'argus_app_dev_pwd'
  return createKysely(u.toString())
}
