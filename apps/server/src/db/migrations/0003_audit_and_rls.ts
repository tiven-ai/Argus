import { type Kysely, sql } from 'kysely'

const RLS_TABLES = ['projects', 'sessions', 'steps', 'step_events', 'audit_log'] as const

export async function up(db: Kysely<unknown>): Promise<void> {
  // ---- 1. Runtime role (NO BYPASSRLS, NO SUPERUSER) ----
  // NOTE: pg query-protocol cannot pass parameters into a DO $$ … $$ block
  // (the $$-quoting collides with $N placeholders). We inline the password as
  // a SQL literal via sql.lit (safe — the value comes from a controlled env
  // var, and sql.lit applies Kysely's literal-quoting).
  const pwd = process.env.ARGUS_APP_DB_PASSWORD ?? 'argus_app_dev_pwd'
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argus_app') THEN
        EXECUTE format('CREATE ROLE argus_app LOGIN PASSWORD %L', ${sql.lit(pwd)});
      ELSE
        EXECUTE format('ALTER ROLE argus_app WITH LOGIN PASSWORD %L', ${sql.lit(pwd)});
      END IF;
    END
    $$;
  `.execute(db)

  // ---- 2. Grants on schema + existing tables + sequences ----
  await sql`GRANT USAGE ON SCHEMA public TO argus_app`.execute(db)
  await sql`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO argus_app`.execute(
    db,
  )
  await sql`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO argus_app`.execute(db)
  await sql`
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO argus_app
  `.execute(db)
  await sql`
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO argus_app
  `.execute(db)

  // ---- 3. audit_log table ----
  await db.schema
    .createTable('audit_log')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('timestamp', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('org_id', 'uuid', (col) => col.notNull().references('orgs.id').onDelete('cascade'))
    .addColumn('actor_user_id', 'uuid', (col) => col.references('users.id').onDelete('set null'))
    .addColumn('event_type', 'text', (col) => col.notNull())
    .addColumn('target_kind', 'text')
    .addColumn('target_id', 'text')
    .addColumn('metadata', 'jsonb')
    .addColumn('ip', 'text')
    .addColumn('user_agent', 'text')
    .execute()
  await sql`CREATE INDEX audit_log_org_time_idx ON audit_log (org_id, timestamp DESC)`.execute(db)
  // Re-grant explicitly because the bulk GRANT above ran before audit_log existed.
  // (Default privileges only apply going forward but include this since they were
  // set before CREATE TABLE; both belt + suspenders.)
  await sql`GRANT SELECT, INSERT, UPDATE, DELETE ON audit_log TO argus_app`.execute(db)

  // ---- 4. Add org_id to sessions/steps/step_events BEFORE creating RLS policies ----
  // sessions / steps / step_events don't have a direct org_id column — they reach
  // it via service_id → project_id → org_id. We need to ADD org_id columns so the
  // policy comparisons compile. This is the M7 schema reshape.
  //
  // Approach: add org_id column (NOT NULL, references orgs(id)) and backfill from
  // the existing join chain. Then the policy is the same template for all five tables.
  // NOTE: This step is ordered BEFORE the RLS policy creation (Step 5 below) so that
  // the `org_id = …` predicate in each policy resolves at CREATE time.

  // Add org_id to sessions
  await db.schema
    .alterTable('sessions')
    .addColumn('org_id', 'uuid', (col) => col.references('orgs.id').onDelete('cascade'))
    .execute()
  await sql`
    UPDATE sessions ses SET org_id = prj.org_id
    FROM services svc JOIN projects prj ON prj.id = svc.project_id
    WHERE ses.service_id = svc.id
  `.execute(db)
  await sql`ALTER TABLE sessions ALTER COLUMN org_id SET NOT NULL`.execute(db)
  await sql`CREATE INDEX sessions_org_time_idx ON sessions (org_id, started_at DESC)`.execute(db)

  // Add org_id to steps
  await db.schema
    .alterTable('steps')
    .addColumn('org_id', 'uuid', (col) => col.references('orgs.id').onDelete('cascade'))
    .execute()
  await sql`
    UPDATE steps stp SET org_id = ses.org_id
    FROM sessions ses
    WHERE stp.session_id = ses.id
  `.execute(db)
  await sql`ALTER TABLE steps ALTER COLUMN org_id SET NOT NULL`.execute(db)
  await sql`CREATE INDEX steps_org_session_idx ON steps (org_id, session_id)`.execute(db)

  // Add org_id to step_events
  await db.schema
    .alterTable('step_events')
    .addColumn('org_id', 'uuid', (col) => col.references('orgs.id').onDelete('cascade'))
    .execute()
  await sql`
    UPDATE step_events ev SET org_id = stp.org_id
    FROM steps stp
    WHERE ev.step_id = stp.id
  `.execute(db)
  await sql`ALTER TABLE step_events ALTER COLUMN org_id SET NOT NULL`.execute(db)
  await sql`CREATE INDEX step_events_org_step_idx ON step_events (org_id, step_id)`.execute(db)

  // ---- 5. RLS policies on tenant tables (now that org_id exists everywhere) ----
  for (const t of RLS_TABLES) {
    await sql`ALTER TABLE ${sql.raw(t)} ENABLE ROW LEVEL SECURITY`.execute(db)
    await sql`ALTER TABLE ${sql.raw(t)} FORCE ROW LEVEL SECURITY`.execute(db)
    await sql`
      CREATE POLICY tenant_isolation ON ${sql.raw(t)}
        USING      (org_id = current_setting('argus.current_org_id', true)::uuid)
        WITH CHECK (org_id = current_setting('argus.current_org_id', true)::uuid)
    `.execute(db)
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const t of RLS_TABLES) {
    await sql`DROP POLICY IF EXISTS tenant_isolation ON ${sql.raw(t)}`.execute(db)
    await sql`ALTER TABLE ${sql.raw(t)} DISABLE ROW LEVEL SECURITY`.execute(db)
  }
  await sql`DROP INDEX IF EXISTS step_events_org_step_idx`.execute(db)
  await sql`ALTER TABLE step_events DROP COLUMN IF EXISTS org_id`.execute(db)
  await sql`DROP INDEX IF EXISTS steps_org_session_idx`.execute(db)
  await sql`ALTER TABLE steps DROP COLUMN IF EXISTS org_id`.execute(db)
  await sql`DROP INDEX IF EXISTS sessions_org_time_idx`.execute(db)
  await sql`ALTER TABLE sessions DROP COLUMN IF EXISTS org_id`.execute(db)
  await sql`DROP INDEX IF EXISTS audit_log_org_time_idx`.execute(db)
  await db.schema.dropTable('audit_log').execute()
  await sql`
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM argus_app;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM argus_app;
    REVOKE USAGE ON SCHEMA public FROM argus_app;
    REASSIGN OWNED BY argus_app TO postgres;
    DROP OWNED BY argus_app;
    DROP ROLE IF EXISTS argus_app;
  `.execute(db)
}
