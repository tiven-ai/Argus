import { type Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE users ADD COLUMN password_version int NOT NULL DEFAULT 1`.execute(db)
  // GRANT was set globally in 0003; this is belt-and-suspenders for fresh dev envs.
  await sql`GRANT UPDATE ON users TO argus_app`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE users DROP COLUMN IF EXISTS password_version`.execute(db)
}
