import { sql, type Kysely } from 'kysely'
import type { DB } from '../../src/db/schema.js'
import { createKysely } from '../../src/db/kysely.js'

export function createTestDb(): Kysely<DB> {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL not set — global setup did not run')
  return createKysely(url)
}

export async function truncateAll(db: Kysely<DB>): Promise<void> {
  // Truncate everything except orgs (we keep the default org row).
  await sql`TRUNCATE TABLE step_events, steps, sessions, services, projects RESTART IDENTITY CASCADE`.execute(
    db,
  )
}
