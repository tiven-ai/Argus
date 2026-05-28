import { type Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('orgs')
    .addColumn('id', 'uuid', (col) => col.primaryKey())
    .addColumn('name', 'varchar(255)', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  await sql`
    INSERT INTO orgs (id, name)
    VALUES ('00000000-0000-0000-0000-000000000000', 'default')
    ON CONFLICT DO NOTHING
  `.execute(db)

  await db.schema
    .createTable('projects')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('org_id', 'uuid', (col) => col.notNull().references('orgs.id').onDelete('cascade'))
    .addColumn('name', 'varchar(255)', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('projects_org_name_unique', ['org_id', 'name'])
    .execute()

  await db.schema
    .createTable('services')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('project_id', 'uuid', (col) =>
      col.notNull().references('projects.id').onDelete('cascade'),
    )
    .addColumn('name', 'varchar(255)', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('services_project_name_unique', ['project_id', 'name'])
    .execute()

  await db.schema
    .createTable('sessions')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('service_id', 'uuid', (col) =>
      col.notNull().references('services.id').onDelete('cascade'),
    )
    .addColumn('trace_id', 'varchar(32)', (col) => col.notNull())
    .addColumn('started_at', 'timestamptz', (col) => col.notNull())
    .addColumn('ended_at', 'timestamptz')
    .addColumn('step_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addUniqueConstraint('sessions_service_trace_unique', ['service_id', 'trace_id'])
    .execute()

  await db.schema
    .createIndex('idx_sessions_service_started')
    .on('sessions')
    .columns(['service_id', 'started_at desc'])
    .execute()

  await db.schema
    .createTable('steps')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('session_id', 'uuid', (col) =>
      col.notNull().references('sessions.id').onDelete('cascade'),
    )
    .addColumn('span_id', 'varchar(16)', (col) => col.notNull())
    .addColumn('parent_span_id', 'varchar(16)')
    .addColumn('name', 'varchar(255)', (col) => col.notNull())
    .addColumn('kind', 'varchar(50)')
    .addColumn('component_type', 'varchar(50)')
    .addColumn('component_name', 'varchar(255)')
    .addColumn('started_at', 'timestamptz', (col) => col.notNull())
    .addColumn('ended_at', 'timestamptz', (col) => col.notNull())
    .addColumn('attributes', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('status_code', 'varchar(20)', (col) => col.notNull().defaultTo('UNSET'))
    .addColumn('status_message', 'text')
    .addUniqueConstraint('steps_session_span_unique', ['session_id', 'span_id'])
    .execute()

  await db.schema
    .createIndex('idx_steps_session_started')
    .on('steps')
    .columns(['session_id', 'started_at'])
    .execute()

  await db.schema
    .createTable('step_events')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('step_id', 'uuid', (col) => col.notNull().references('steps.id').onDelete('cascade'))
    .addColumn('name', 'varchar(255)', (col) => col.notNull())
    .addColumn('ts', 'timestamptz', (col) => col.notNull())
    .addColumn('attributes', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
    .execute()

  await db.schema
    .createIndex('idx_step_events_step')
    .on('step_events')
    .columns(['step_id'])
    .execute()
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('step_events').execute()
  await db.schema.dropTable('steps').execute()
  await db.schema.dropTable('sessions').execute()
  await db.schema.dropTable('services').execute()
  await db.schema.dropTable('projects').execute()
  await db.schema.dropTable('orgs').execute()
}
