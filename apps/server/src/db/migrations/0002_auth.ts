import { type Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('users')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('email', 'varchar(255)', (col) => col.notNull().unique())
    .addColumn('password_hash', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  // Insert the default-user row for ARGUS_MODE=local. The password_hash is a
  // sentinel that can never match a bcryptjs comparison (length is wrong).
  await sql`
    INSERT INTO users (id, email, password_hash)
    VALUES ('11111111-1111-1111-1111-111111111111', 'local@argus.dev', '$local$')
    ON CONFLICT DO NOTHING
  `.execute(db)

  await db.schema
    .createTable('org_members')
    .addColumn('user_id', 'uuid', (col) => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('org_id', 'uuid', (col) => col.notNull().references('orgs.id').onDelete('cascade'))
    .addColumn('role', 'varchar(50)', (col) => col.notNull().defaultTo('owner'))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint('org_members_pk', ['user_id', 'org_id'])
    .execute()

  // Link the default-user to the default-org.
  await sql`
    INSERT INTO org_members (user_id, org_id, role)
    VALUES ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'owner')
    ON CONFLICT DO NOTHING
  `.execute(db)

  await db.schema
    .createTable('ingest_tokens')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('project_id', 'uuid', (col) =>
      col.notNull().references('projects.id').onDelete('cascade'),
    )
    .addColumn('name', 'varchar(255)', (col) => col.notNull())
    .addColumn('token_prefix', 'varchar(16)', (col) => col.notNull())
    .addColumn('token_hash', 'text', (col) => col.notNull().unique())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('revoked_at', 'timestamptz')
    .execute()

  await sql`CREATE INDEX idx_ingest_tokens_hash_active ON ingest_tokens(token_hash) WHERE revoked_at IS NULL`.execute(
    db,
  )
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('ingest_tokens').execute()
  await db.schema.dropTable('org_members').execute()
  await db.schema.dropTable('users').execute()
}
