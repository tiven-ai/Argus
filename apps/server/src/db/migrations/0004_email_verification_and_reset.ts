import { type Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  // 1. Add the verification timestamp to users.
  await sql`ALTER TABLE users ADD COLUMN email_verified_at timestamptz`.execute(db)

  // 2. Polymorphic one-time-token table (auth-tier; not under RLS).
  await db.schema
    .createTable('auth_one_time_tokens')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('user_id', 'uuid', (col) => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('kind', 'text', (col) => col.notNull())
    .addColumn('token_hash', 'text', (col) => col.notNull().unique())
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .addColumn('consumed_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  await sql`
    CREATE INDEX auth_tokens_user_kind_active_idx
      ON auth_one_time_tokens (user_id, kind, created_at DESC)
      WHERE consumed_at IS NULL
  `.execute(db)
  await sql`
    CREATE INDEX auth_tokens_hash_active_idx
      ON auth_one_time_tokens (token_hash)
      WHERE consumed_at IS NULL
  `.execute(db)

  // 3. Grant to the M7 runtime role.
  await sql`GRANT SELECT, INSERT, UPDATE ON auth_one_time_tokens TO argus_app`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`REVOKE ALL ON auth_one_time_tokens FROM argus_app`.execute(db)
  await db.schema.dropTable('auth_one_time_tokens').execute()
  await sql`ALTER TABLE users DROP COLUMN IF EXISTS email_verified_at`.execute(db)
}
