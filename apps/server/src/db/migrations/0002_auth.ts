import { type Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('users')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('email', 'varchar(255)', (col) => col.notNull().unique())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  await sql`
    INSERT INTO users (id, email)
    VALUES ('11111111-1111-1111-1111-111111111111', 'local@argus.dev')
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

  await sql`
    INSERT INTO org_members (user_id, org_id, role)
    VALUES ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'owner')
    ON CONFLICT DO NOTHING
  `.execute(db)

  await db.schema
    .createTable('ingest_tokens')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('org_id', 'uuid', (col) => col.notNull().references('orgs.id').onDelete('cascade'))
    .addColumn('token_hash', 'varchar(64)', (col) => col.notNull())
    .addColumn('label', 'varchar(255)')
    .addColumn('created_by', 'uuid', (col) =>
      col.notNull().references('users.id').onDelete('restrict'),
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('revoked_at', 'timestamptz')
    .execute()

  await db.schema
    .createIndex('idx_ingest_tokens_hash_active')
    .on('ingest_tokens')
    .column('token_hash')
    .where(sql.ref('revoked_at'), 'is', null)
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('ingest_tokens').execute()
  await db.schema.dropTable('org_members').execute()
  await db.schema.dropTable('users').execute()
}
