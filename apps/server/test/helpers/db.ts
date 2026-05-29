import { sql, type Kysely } from 'kysely'
import type { DB } from '../../src/db/schema.js'
import { createKysely } from '../../src/db/kysely.js'

export function createTestDb(): Kysely<DB> {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL not set — global setup did not run')
  return createKysely(url)
}

export async function truncateAll(db: Kysely<DB>): Promise<void> {
  // Truncate all data tables except orgs (we keep the default org row).
  // Also preserve the default user + org_member seeded by migration 0002.
  await sql`TRUNCATE TABLE step_events, steps, sessions, services, projects, ingest_tokens RESTART IDENTITY CASCADE`.execute(
    db,
  )
  await sql`DELETE FROM org_members WHERE user_id != '11111111-1111-1111-1111-111111111111'`.execute(
    db,
  )
  await sql`DELETE FROM users WHERE id != '11111111-1111-1111-1111-111111111111'`.execute(db)
}
