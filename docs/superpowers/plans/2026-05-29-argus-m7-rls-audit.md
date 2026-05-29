# Argus M7 — RLS + Audit Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a database-layer multi-tenant defense (Postgres row-level security keyed on a per-transaction GUC) and a server-side audit trail covering authentication and ingest-token CRUD.

**Architecture:** Migration `0003` creates the `argus_app` PG role (NO BYPASSRLS), enables RLS + a single `tenant_isolation` policy on five tenant tables (`projects`, `sessions`, `steps`, `step_events`, `audit_log`), and creates the `audit_log` table. A new Fastify decorator `app.withTenantTx(orgId, fn)` wraps each authenticated handler in a transaction that issues `SET LOCAL argus.current_org_id`. DAOs (`PgStorage`, `processIngestion`) change their signature to accept a `Transaction<DB>`. The `audit` module exposes a single `record(trx, args)` writer used by auth + token routes.

**Tech Stack:** Postgres 16 (existing), Kysely 0.27 (existing), Fastify 5 (existing), Vitest + testcontainers (existing). No new runtime deps.

**Spec:** [docs/superpowers/specs/2026-05-29-argus-m7-rls-audit-design.md](../specs/2026-05-29-argus-m7-rls-audit-design.md)

---

## File Structure

```
apps/server/src/
├── db/
│   ├── migrations/
│   │   └── 0003_audit_and_rls.ts          (NEW: roles, audit_log table, RLS policies)
│   └── schema.ts                          (MODIFIED: + AuditLog interface, + audit_log in DB)
├── modules/
│   ├── db-tenant/                         (NEW MODULE)
│   │   ├── index.ts                       (export withTenantTx + Tx type + decorator factory)
│   │   ├── decorator.ts                   (Fastify plugin registering app.withTenantTx)
│   │   └── types.ts                       (Tx = Transaction<DB>)
│   ├── audit/                             (NEW MODULE)
│   │   ├── index.ts                       (public surface)
│   │   ├── types.ts                       (AuditEventType, RecordArgs)
│   │   └── record.ts                      (INSERT helper)
│   ├── storage/
│   │   ├── pg.ts                          (MODIFIED: methods take Tx; constructor drops db)
│   │   └── types.ts                       (MODIFIED: StorageBackend method sigs take Tx)
│   ├── ingest/
│   │   ├── pipeline.ts                    (MODIFIED: processIngestion takes Tx)
│   │   └── routes.ts                      (MODIFIED: wrap call in withTenantTx)
│   ├── ingest-grpc/
│   │   └── service.ts                     (MODIFIED: wrap processIngestion in withTenantTx)
│   ├── pusher/
│   │   └── routes.ts                      (MODIFIED: wrap getSession in withTenantTx)
│   ├── api/
│   │   └── routes.ts                      (MODIFIED: wrap listSessions/getSession in withTenantTx)
│   ├── auth/
│   │   └── routes.ts                      (MODIFIED: emit audit on login_success / register; pino on login_failure)
│   └── tokens/
│       └── routes.ts                      (MODIFIED: emit audit on token_create / token_revoke)
├── env.ts                                 (MODIFIED: + APP_DATABASE_URL)
├── server.ts                              (MODIFIED: appDatabaseUrl option; build app-role pool)
└── main.ts                                (MODIFIED: pass env.APP_DATABASE_URL through; build PgStorage with no db arg)

apps/server/test/
├── helpers/
│   └── db.ts                              (MODIFIED: + createAppRoleTestDb)
├── db-tenant/                             (NEW)
│   ├── withTenantTx.test.ts
│   └── tenant-isolation.integration.test.ts
├── audit/                                 (NEW)
│   ├── record.test.ts
│   └── integration.test.ts
├── storage/pg.test.ts                     (MODIFIED: wrap calls in withTenantTx)
├── ingest/pipeline.test.ts                (MODIFIED: pass trx to processIngestion)
├── ingest-grpc/grpc-integration.test.ts   (MODIFIED if needed)
├── pusher/sse-integration.test.ts         (MODIFIED if needed)
└── api/routes.test.ts                     (MODIFIED if needed)

infra/docker/docker-compose.yml            (MODIFIED: APP_DATABASE_URL not strictly needed since
                                            compose's POSTGRES env is for migration role only;
                                            no change required — APP_DATABASE_URL is only consumed
                                            by the server binary at runtime via env)

CLAUDE.md                                  (MODIFIED: replace pitfall + add new working rule)
```

---

## Common Conventions

- Commit messages: Conventional Commits, lowercase subject (commitlint).
- No `git commit --no-verify` / `--no-gpg-sign`.
- TypeScript strict mode; never use `any` without an explicit `// reason: <why>` comment.
- Tests use Vitest + testcontainers (PostgreSQL 16). Global setup at `test/setup/global.ts` runs migrations once per suite.
- `super-user` connection (testcontainers default credentials `argus:argus`) bypasses RLS because it's a superuser; tests that exercise RLS must use the `argus_app` role connection via `createAppRoleTestDb()`.
- Pre-commit hook runs `lint-staged` (eslint + prettier). Commit will reformat — that's expected.

---

## Task 1: Migration 0003 — roles, audit_log table, RLS policies

**Files:**

- Create: `apps/server/src/db/migrations/0003_audit_and_rls.ts`
- Modify: `apps/server/src/db/schema.ts`

### Step 1: Add `AuditLog` interface + `audit_log` member to `DB` in `apps/server/src/db/schema.ts`

After the `IngestTokens` interface (line ~81), add:

```ts
export interface AuditLog {
  id: Generated<string>
  timestamp: Generated<Timestamp>
  org_id: string
  actor_user_id: string | null
  event_type: string
  target_kind: string | null
  target_id: string | null
  metadata: Json | null
  ip: string | null
  user_agent: string | null
}
```

And add `audit_log: AuditLog` to the `DB` interface at the end:

```ts
export interface DB {
  orgs: Orgs
  projects: Projects
  services: Services
  sessions: Sessions
  steps: Steps
  step_events: StepEvents
  users: Users
  org_members: OrgMembers
  ingest_tokens: IngestTokens
  audit_log: AuditLog
}
```

### Step 2: Create `apps/server/src/db/migrations/0003_audit_and_rls.ts`

```ts
import { type Kysely, sql } from 'kysely'

const RLS_TABLES = ['projects', 'sessions', 'steps', 'step_events', 'audit_log'] as const

export async function up(db: Kysely<unknown>): Promise<void> {
  // ---- 1. Runtime role (NO BYPASSRLS, NO SUPERUSER) ----
  const pwd = process.env.ARGUS_APP_DB_PASSWORD ?? 'argus_app_dev_pwd'
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'argus_app') THEN
        EXECUTE format('CREATE ROLE argus_app LOGIN PASSWORD %L', ${pwd});
      ELSE
        EXECUTE format('ALTER ROLE argus_app WITH LOGIN PASSWORD %L', ${pwd});
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

  // ---- 4. RLS policies on tenant tables ----
  for (const t of RLS_TABLES) {
    await sql`ALTER TABLE ${sql.raw(t)} ENABLE ROW LEVEL SECURITY`.execute(db)
    await sql`ALTER TABLE ${sql.raw(t)} FORCE ROW LEVEL SECURITY`.execute(db)
    await sql`
      CREATE POLICY tenant_isolation ON ${sql.raw(t)}
        USING      (org_id = current_setting('argus.current_org_id', true)::uuid)
        WITH CHECK (org_id = current_setting('argus.current_org_id', true)::uuid)
    `.execute(db)
  }

  // ---- 5. Verify org_id is present on each RLS table at policy-create time ----
  // sessions / steps / step_events don't have a direct org_id column — they reach
  // it via service_id → project_id → org_id. We need to ADD org_id columns so the
  // policy comparisons compile. This is the M7 schema reshape.
  //
  // Approach: add org_id column (NOT NULL, references orgs(id)) and backfill from
  // the existing join chain. Then the policy is the same template for all five tables.

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
```

### Step 3: Update `apps/server/src/db/schema.ts` to add `org_id` fields

Sessions / Steps / StepEvents interfaces need an `org_id: string` field added. Replace those three blocks:

```ts
export interface Sessions {
  id: Generated<string>
  service_id: string
  org_id: string
  trace_id: string
  started_at: Timestamp
  ended_at: Timestamp | null
  step_count: Generated<number>
}

export interface Steps {
  id: Generated<string>
  session_id: string
  org_id: string
  span_id: string
  parent_span_id: string | null
  name: string
  kind: string | null
  component_type: string | null
  component_name: string | null
  started_at: Timestamp
  ended_at: Timestamp
  attributes: Json
  status_code: Generated<string>
  status_message: string | null
}

export interface StepEvents {
  id: Generated<string>
  step_id: string
  org_id: string
  name: string
  ts: Timestamp
  attributes: Json
}
```

### Step 4: Run typecheck — the storage code that writes these tables now needs `org_id` in the insert payload, so it won't compile yet. That's the next task. For now just verify migration syntax compiles.

```bash
pnpm --filter @argus/server typecheck 2>&1 | head -40
```

Expected: `Property 'org_id' is missing` errors in `apps/server/src/modules/storage/pg.ts`. That's fine — we'll fix in Task 6.

### Step 5: Stage but don't commit yet — Tasks 1, 2, 3 all touch the schema's contract and must land together or the build is red. Final commit is at the end of Task 3.

```bash
git status --short
```

Expected: `M` on `schema.ts`, `??` on the new migration file.

---

## Task 2: `db-tenant` module — `withTenantTx` decorator + `Tx` type

**Files:**

- Create: `apps/server/src/modules/db-tenant/index.ts`
- Create: `apps/server/src/modules/db-tenant/types.ts`
- Create: `apps/server/src/modules/db-tenant/decorator.ts`

### Step 1: Create `apps/server/src/modules/db-tenant/types.ts`

```ts
import type { Transaction } from 'kysely'
import type { DB } from '../../db/schema.js'

/**
 * Alias for the Kysely transaction type bound to our DB schema. Every DAO that
 * touches a tenant table accepts this in M7+.
 */
export type Tx = Transaction<DB>
```

### Step 2: Create `apps/server/src/modules/db-tenant/decorator.ts`

```ts
import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import type { DB } from '../../db/schema.js'
import type { Tx } from './types.js'

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * Run `fn` inside a Kysely transaction with `argus.current_org_id` set so
     * tenant-data tables under RLS resolve to the caller's org. If `fn` throws,
     * the transaction rolls back; the GUC is local to the transaction so it
     * cannot leak back to the connection pool.
     */
    withTenantTx<T>(orgId: string, fn: (trx: Tx) => Promise<T>): Promise<T>
  }
}

export interface DbTenantDeps {
  db: Kysely<DB>
}

export const dbTenantPlugin: FastifyPluginAsync<DbTenantDeps> = async (
  app: FastifyInstance,
  deps,
) => {
  app.decorate('withTenantTx', function <T>(orgId: string, fn: (trx: Tx) => Promise<T>) {
    return deps.db.transaction().execute(async (trx) => {
      await sql`SELECT set_config('argus.current_org_id', ${orgId}, true)`.execute(trx)
      return fn(trx)
    })
  })
}
```

> Note: We use `set_config(name, value, true)` instead of `SET LOCAL …` because `set_config(..., is_local := true)` accepts a parameterized value at the protocol level. `SET LOCAL` requires the value to be inline-literal in the SQL text, which doesn't compose with prepared statements / Kysely's parameter binding.

### Step 3: Create `apps/server/src/modules/db-tenant/index.ts`

```ts
export { dbTenantPlugin, type DbTenantDeps } from './decorator.js'
export type { Tx } from './types.js'
```

### Step 4: typecheck — `dbTenantPlugin` and `Tx` should compile cleanly (independent of T1's pending schema reshape).

```bash
pnpm --filter @argus/server typecheck 2>&1 | grep -E "db-tenant" || echo "db-tenant module typechecks cleanly"
```

Expected: `db-tenant module typechecks cleanly`. (Other typecheck errors from T1's schema reshape are still present but in unrelated files.)

### Step 5: Don't commit yet — see Task 3.

---

## Task 3: Test fixture `createAppRoleTestDb` + migration sanity test

**Files:**

- Modify: `apps/server/test/helpers/db.ts`
- Create: `apps/server/test/db-tenant/migration-roles.test.ts`

### Step 1: Modify `apps/server/test/helpers/db.ts` — add `createAppRoleTestDb`

Append:

```ts
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
```

Also: in the same file, update the existing `truncateAll` to truncate `audit_log`. Replace:

```ts
export async function truncateAll(db: Kysely<DB>): Promise<void> {
  await sql`TRUNCATE TABLE step_events, steps, sessions, services, projects, ingest_tokens RESTART IDENTITY CASCADE`.execute(
    db,
  )
  // …
}
```

With:

```ts
export async function truncateAll(db: Kysely<DB>): Promise<void> {
  await sql`TRUNCATE TABLE audit_log, step_events, steps, sessions, services, projects, ingest_tokens RESTART IDENTITY CASCADE`.execute(
    db,
  )
  // …
}
```

### Step 2: Create `apps/server/test/db-tenant/migration-roles.test.ts`

```ts
import { describe, expect, test, afterAll } from 'vitest'
import { sql } from 'kysely'
import { createAppRoleTestDb, createTestDb } from '../helpers/db.js'

describe('migration 0003 — roles + RLS topology', () => {
  const adminDb = createTestDb()
  const appDb = createAppRoleTestDb()
  afterAll(async () => {
    await adminDb.destroy()
    await appDb.destroy()
  })

  test('argus_app role exists and is non-superuser, non-bypassrls', async () => {
    const row = await sql<{
      rolname: string
      rolsuper: boolean
      rolbypassrls: boolean
      rolcanlogin: boolean
    }>`
      SELECT rolname, rolsuper, rolbypassrls, rolcanlogin
      FROM pg_roles WHERE rolname = 'argus_app'
    `.execute(adminDb)
    expect(row.rows).toHaveLength(1)
    expect(row.rows[0].rolsuper).toBe(false)
    expect(row.rows[0].rolbypassrls).toBe(false)
    expect(row.rows[0].rolcanlogin).toBe(true)
  })

  test('argus_app can connect and SELECT on a non-RLS table (users)', async () => {
    const rows = await appDb.selectFrom('users').selectAll().execute()
    // Should at least see the seeded local user from migration 0002.
    expect(rows.length).toBeGreaterThan(0)
  })

  test('RLS is enabled and forced on tenant tables', async () => {
    const rows = await sql<{
      relname: string
      relrowsecurity: boolean
      relforcerowsecurity: boolean
    }>`
      SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE relname IN ('projects', 'sessions', 'steps', 'step_events', 'audit_log')
    `.execute(adminDb)
    for (const r of rows.rows) {
      expect(r.relrowsecurity, `${r.relname} should have RLS enabled`).toBe(true)
      expect(r.relforcerowsecurity, `${r.relname} should have RLS forced`).toBe(true)
    }
  })

  test('tenant_isolation policy exists on each RLS table', async () => {
    const rows = await sql<{ tablename: string; policyname: string }>`
      SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public'
    `.execute(adminDb)
    const byTable = Object.fromEntries(rows.rows.map((r) => [r.tablename, r.policyname]))
    expect(byTable.projects).toBe('tenant_isolation')
    expect(byTable.sessions).toBe('tenant_isolation')
    expect(byTable.steps).toBe('tenant_isolation')
    expect(byTable.step_events).toBe('tenant_isolation')
    expect(byTable.audit_log).toBe('tenant_isolation')
  })
})
```

### Step 3: Run only this new test file. It needs testcontainers to come up, then runs migrations (which now includes 0003).

```bash
pnpm --filter @argus/server test test/db-tenant/migration-roles.test.ts 2>&1 | tail -30
```

Expected: 4 tests pass. If migration 0003 has a bug, the suite fails at global setup — fix and re-run.

### Step 4: Stage tasks 1+2+3 together and commit

```bash
git add apps/server/src/db/migrations/0003_audit_and_rls.ts \
        apps/server/src/db/schema.ts \
        apps/server/src/modules/db-tenant \
        apps/server/test/helpers/db.ts \
        apps/server/test/db-tenant/migration-roles.test.ts
git commit -m "feat(server): m7 migration — argus_app role, audit_log, rls policies + db-tenant module"
```

---

## Task 4: Tenant-isolation integration test

Confirms the multi-tenant boundary is real: org B cannot read or write org A's data even with hand-crafted SQL.

**Files:**

- Create: `apps/server/test/db-tenant/withTenantTx.test.ts`
- Create: `apps/server/test/db-tenant/tenant-isolation.integration.test.ts`

### Step 1: Create `apps/server/test/db-tenant/withTenantTx.test.ts`

This unit test asserts `set_config` is set inside the tx and not outside.

```ts
import { describe, expect, test, beforeAll, afterAll } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { sql } from 'kysely'
import { dbTenantPlugin } from '../../src/modules/db-tenant/index.js'
import { createAppRoleTestDb } from '../helpers/db.js'

describe('withTenantTx', () => {
  let app: FastifyInstance
  const db = createAppRoleTestDb()
  const ORG_A = '00000000-0000-0000-0000-00000000aaaa'
  // Insert org_a once before the suite via super-user; argus_app can't INSERT into orgs.
  // We piggyback on createTestDb for setup.

  beforeAll(async () => {
    app = Fastify()
    await app.register(dbTenantPlugin, { db })
    // ensure org_a exists
    const { createTestDb } = await import('../helpers/db.js')
    const admin = createTestDb()
    await sql`INSERT INTO orgs (id, name) VALUES (${ORG_A}, 'test-a') ON CONFLICT DO NOTHING`.execute(
      admin,
    )
    await admin.destroy()
  })
  afterAll(async () => {
    await app.close()
    await db.destroy()
  })

  test('SET LOCAL takes effect inside the tx', async () => {
    const orgIdSeen = await app.withTenantTx(ORG_A, async (trx) => {
      const { rows } = await sql<{ current_setting: string }>`
        SELECT current_setting('argus.current_org_id', true) AS current_setting
      `.execute(trx)
      return rows[0]?.current_setting
    })
    expect(orgIdSeen).toBe(ORG_A)
  })

  test('GUC does not leak to the next pool acquire', async () => {
    await app.withTenantTx(ORG_A, async (trx) => {
      await sql`SELECT 1`.execute(trx)
    })
    // Open a fresh tx in the same pool and check the GUC is unset.
    const orgIdSeen = await db.transaction().execute(async (trx) => {
      const { rows } = await sql<{ current_setting: string | null }>`
        SELECT current_setting('argus.current_org_id', true) AS current_setting
      `.execute(trx)
      return rows[0]?.current_setting ?? null
    })
    expect(orgIdSeen === '' || orgIdSeen === null).toBe(true)
  })

  test('rollback on throw — fn throws → tx rolls back', async () => {
    await expect(
      app.withTenantTx(ORG_A, async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    // No side effects observable; if our `set_config` somehow persisted, the next
    // test would fail. The previous test covers that.
  })
})
```

### Step 2: Create `apps/server/test/db-tenant/tenant-isolation.integration.test.ts`

```ts
import { describe, expect, test, beforeAll, afterAll, beforeEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { sql } from 'kysely'
import { dbTenantPlugin } from '../../src/modules/db-tenant/index.js'
import { createAppRoleTestDb, createTestDb, truncateAll } from '../helpers/db.js'

const ORG_A = '00000000-0000-0000-0000-00000000aaaa'
const ORG_B = '00000000-0000-0000-0000-00000000bbbb'
const PROJ_A = '00000000-0000-0000-0000-0000000000a1'
const PROJ_B = '00000000-0000-0000-0000-0000000000b1'

describe('tenant_isolation policy', () => {
  let app: FastifyInstance
  const appDb = createAppRoleTestDb()
  const admin = createTestDb()

  beforeAll(async () => {
    app = Fastify()
    await app.register(dbTenantPlugin, { db: appDb })
  })
  beforeEach(async () => {
    await truncateAll(admin)
    // Seed two orgs + one project each via super-user.
    await sql`INSERT INTO orgs (id, name) VALUES (${ORG_A}, 'a'), (${ORG_B}, 'b')`.execute(admin)
    await sql`
      INSERT INTO projects (id, org_id, name) VALUES (${PROJ_A}, ${ORG_A}, 'pA'), (${PROJ_B}, ${ORG_B}, 'pB')
    `.execute(admin)
  })
  afterAll(async () => {
    await app.close()
    await appDb.destroy()
    await admin.destroy()
  })

  test('argus_app sees zero rows on tenant tables without SET LOCAL', async () => {
    const rows = await appDb.selectFrom('projects').selectAll().execute()
    expect(rows).toHaveLength(0)
  })

  test('SET LOCAL to org A → only project A is visible', async () => {
    const rows = await app.withTenantTx(ORG_A, async (trx) =>
      trx.selectFrom('projects').selectAll().execute(),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(PROJ_A)
  })

  test('SET LOCAL to org B → only project B is visible', async () => {
    const rows = await app.withTenantTx(ORG_B, async (trx) =>
      trx.selectFrom('projects').selectAll().execute(),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(PROJ_B)
  })

  test('INSERT into org A while SET to org B raises RowSecurityViolation', async () => {
    await expect(
      app.withTenantTx(ORG_B, async (trx) =>
        trx
          .insertInto('projects')
          .values({ org_id: ORG_A, name: 'sneak' })
          .returning('id')
          .executeTakeFirstOrThrow(),
      ),
    ).rejects.toThrow(/row[- ]?level security|new row violates/i)
  })
})
```

### Step 3: Run

```bash
pnpm --filter @argus/server test test/db-tenant/ 2>&1 | tail -20
```

Expected: 4 + 3 = 7 tests passing.

> NOTE: the existing storage / ingest / api tests still won't pass yet because schema.ts now requires `org_id` on Sessions/Steps/StepEvents inserts. Those get fixed in Task 6. Skip running the full suite until then.

### Step 4: Commit

```bash
git add apps/server/test/db-tenant
git commit -m "test(server): m7 tenant_isolation policy + withTenantTx unit tests"
```

---

## Task 5: `audit` module — types + `record` writer + unit tests

**Files:**

- Create: `apps/server/src/modules/audit/index.ts`
- Create: `apps/server/src/modules/audit/types.ts`
- Create: `apps/server/src/modules/audit/record.ts`
- Create: `apps/server/test/audit/record.test.ts`

### Step 1: Create `apps/server/src/modules/audit/types.ts`

```ts
export type AuditEventType = 'login_success' | 'register' | 'token_create' | 'token_revoke'

export interface RecordArgs {
  eventType: AuditEventType
  actorUserId: string | null
  targetKind?: string
  targetId?: string
  metadata?: Record<string, unknown>
  ip?: string
  userAgent?: string
}
```

### Step 2: Create `apps/server/src/modules/audit/record.ts`

```ts
import { sql } from 'kysely'
import type { Tx } from '../db-tenant/index.js'
import type { RecordArgs } from './types.js'

const MAX_UA = 2048

/**
 * Insert one row into `audit_log`. The `org_id` comes from the active
 * `argus.current_org_id` GUC, which the caller's `withTenantTx` already set.
 *
 * If the GUC is not set, the INSERT violates RLS WITH CHECK and the underlying
 * Postgres error surfaces — that's the loud-fail mode by design.
 */
export async function record(trx: Tx, args: RecordArgs): Promise<void> {
  const { rows } = await sql<{ org_id: string }>`
    SELECT current_setting('argus.current_org_id', false)::uuid AS org_id
  `.execute(trx)
  const orgId = rows[0]?.org_id
  if (!orgId) {
    throw new Error('audit.record: argus.current_org_id GUC is not set on this transaction')
  }
  await trx
    .insertInto('audit_log')
    .values({
      org_id: orgId,
      actor_user_id: args.actorUserId,
      event_type: args.eventType,
      target_kind: args.targetKind ?? null,
      target_id: args.targetId ?? null,
      metadata: args.metadata ? JSON.stringify(args.metadata) : null,
      ip: args.ip ?? null,
      user_agent: args.userAgent ? args.userAgent.slice(0, MAX_UA) : null,
    })
    .execute()
}
```

### Step 3: Create `apps/server/src/modules/audit/index.ts`

```ts
export { record } from './record.js'
export type { AuditEventType, RecordArgs } from './types.js'
```

### Step 4: Create `apps/server/test/audit/record.test.ts`

```ts
import { describe, expect, test, beforeAll, afterAll, beforeEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { sql } from 'kysely'
import { dbTenantPlugin } from '../../src/modules/db-tenant/index.js'
import { record } from '../../src/modules/audit/index.js'
import { createAppRoleTestDb, createTestDb, truncateAll } from '../helpers/db.js'

const ORG_A = '00000000-0000-0000-0000-00000000aaaa'
const USER_A = '00000000-0000-0000-0000-00000000aaab'

describe('audit.record', () => {
  let app: FastifyInstance
  const appDb = createAppRoleTestDb()
  const admin = createTestDb()

  beforeAll(async () => {
    app = Fastify()
    await app.register(dbTenantPlugin, { db: appDb })
  })
  beforeEach(async () => {
    await truncateAll(admin)
    await sql`INSERT INTO orgs (id, name) VALUES (${ORG_A}, 'a')`.execute(admin)
    await sql`INSERT INTO users (id, email, password_hash) VALUES (${USER_A}, 'a@a.com', 'x')`.execute(
      admin,
    )
  })
  afterAll(async () => {
    await app.close()
    await appDb.destroy()
    await admin.destroy()
  })

  test('inserts a row with all fields when set', async () => {
    await app.withTenantTx(ORG_A, async (trx) => {
      await record(trx, {
        eventType: 'token_create',
        actorUserId: USER_A,
        targetKind: 'ingest_token',
        targetId: '11111111-1111-1111-1111-111111111111',
        metadata: { project: 'pA', name: 'prod', prefix: 'argus_a' },
        ip: '127.0.0.1',
        userAgent: 'vitest/1.0',
      })
    })
    const rows = await admin.selectFrom('audit_log').selectAll().execute()
    expect(rows).toHaveLength(1)
    const r = rows[0]
    expect(r.org_id).toBe(ORG_A)
    expect(r.actor_user_id).toBe(USER_A)
    expect(r.event_type).toBe('token_create')
    expect(r.target_kind).toBe('ingest_token')
    expect(r.metadata).toEqual({ project: 'pA', name: 'prod', prefix: 'argus_a' })
    expect(r.ip).toBe('127.0.0.1')
    expect(r.user_agent).toBe('vitest/1.0')
  })

  test('accepts null actor + minimal args', async () => {
    await app.withTenantTx(ORG_A, async (trx) => {
      await record(trx, { eventType: 'register', actorUserId: USER_A })
    })
    const rows = await admin.selectFrom('audit_log').selectAll().execute()
    expect(rows).toHaveLength(1)
    expect(rows[0].target_kind).toBeNull()
    expect(rows[0].metadata).toBeNull()
    expect(rows[0].ip).toBeNull()
    expect(rows[0].user_agent).toBeNull()
  })

  test('throws when called without active GUC (outside withTenantTx)', async () => {
    await expect(
      appDb.transaction().execute(async (trx) => {
        await record(trx, { eventType: 'register', actorUserId: USER_A })
      }),
    ).rejects.toThrow(/argus.current_org_id|unrecognized configuration parameter/)
  })

  test('truncates user_agent at 2048 chars', async () => {
    const longUa = 'a'.repeat(3000)
    await app.withTenantTx(ORG_A, async (trx) => {
      await record(trx, { eventType: 'login_success', actorUserId: USER_A, userAgent: longUa })
    })
    const rows = await admin.selectFrom('audit_log').selectAll().execute()
    expect(rows[0].user_agent?.length).toBe(2048)
  })
})
```

### Step 5: Run

```bash
pnpm --filter @argus/server test test/audit/record.test.ts 2>&1 | tail -20
```

Expected: 4 tests pass.

### Step 6: Commit

```bash
git add apps/server/src/modules/audit apps/server/test/audit/record.test.ts
git commit -m "feat(server): m7 audit module — record + types + unit tests"
```

---

## Task 6: Refactor PgStorage + StorageBackend interface + tests to take `Tx`

**Files:**

- Modify: `apps/server/src/modules/storage/types.ts`
- Modify: `apps/server/src/modules/storage/pg.ts`
- Modify: `apps/server/test/storage/pg.test.ts`

### Step 1: Modify `apps/server/src/modules/storage/types.ts`

Find the `StorageBackend` interface. Change each method to take a `Tx` as the first parameter:

```ts
import type { Tx } from '../db-tenant/index.js'

export interface StorageBackend {
  writeTrace(trx: Tx, input: WriteTraceInput): Promise<WriteTraceResult>
  listSessions(trx: Tx, opts: { orgId: string; limit?: number }): Promise<StoredSessionSummary[]>
  getSession(
    trx: Tx,
    opts: { orgId: string; sessionId: string },
  ): Promise<StoredSessionDetail | null>
}
```

Keep the existing `WriteTraceInput`, `WriteTraceResult`, `StoredSessionSummary`, `StoredSessionDetail`, `NewStep`, `StoredStep`, `StoredStepEvent` interfaces unchanged.

### Step 2: Modify `apps/server/src/modules/storage/pg.ts` — rewrite the class to use `Tx`

The full new file:

```ts
import type { Tx } from '../db-tenant/index.js'
import type {
  NewStep,
  StorageBackend,
  StoredSessionDetail,
  StoredSessionSummary,
  StoredStep,
  StoredStepEvent,
  WriteTraceInput,
  WriteTraceResult,
} from './types.js'

export class PgStorage implements StorageBackend {
  async writeTrace(trx: Tx, input: WriteTraceInput): Promise<WriteTraceResult> {
    const projectId = await this.upsertProject(trx, input.orgId, input.projectName)
    const serviceId = await this.upsertService(trx, projectId, input.serviceName)
    const sessionId = await this.upsertSession(
      trx,
      input.orgId,
      serviceId,
      input.traceId,
      input.sessionStartedAt,
      input.sessionEndedAt,
    )

    const insertedSpanIds: string[] = []
    for (const step of input.steps) {
      const stepId = await this.upsertStep(trx, input.orgId, sessionId, step)
      if (step.events.length > 0) {
        await trx.deleteFrom('step_events').where('step_id', '=', stepId).execute()
        await trx
          .insertInto('step_events')
          .values(
            step.events.map((e) => ({
              org_id: input.orgId,
              step_id: stepId,
              name: e.name,
              ts: e.ts,
              attributes: JSON.stringify(e.attributes),
            })),
          )
          .execute()
      }
      insertedSpanIds.push(step.spanId)
    }

    const { count } = await trx
      .selectFrom('steps')
      .select((eb) => eb.fn.countAll().as('count'))
      .where('session_id', '=', sessionId)
      .executeTakeFirstOrThrow()
    await trx
      .updateTable('sessions')
      .set({ step_count: Number(count) })
      .where('id', '=', sessionId)
      .execute()

    const detail = await this.getSession(trx, { orgId: input.orgId, sessionId })
    const writtenSteps: StoredStep[] =
      detail?.steps.filter((s) => insertedSpanIds.includes(s.spanId)) ?? []

    return { sessionId, writtenSteps }
  }

  async listSessions(
    trx: Tx,
    opts: { orgId: string; limit?: number },
  ): Promise<StoredSessionSummary[]> {
    const limit = opts.limit ?? 50
    const rows = await trx
      .selectFrom('sessions as ses')
      .innerJoin('services as svc', 'svc.id', 'ses.service_id')
      .innerJoin('projects as prj', 'prj.id', 'svc.project_id')
      .where('ses.org_id', '=', opts.orgId)
      .select([
        'ses.id as id',
        'ses.trace_id as traceId',
        'prj.name as projectName',
        'svc.name as serviceName',
        'ses.started_at as startedAt',
        'ses.ended_at as endedAt',
        'ses.step_count as stepCount',
      ])
      .orderBy('ses.started_at', 'desc')
      .limit(limit)
      .execute()

    return rows.map((r) => ({
      ...r,
      startedAt: new Date(r.startedAt as unknown as string),
      endedAt: r.endedAt ? new Date(r.endedAt as unknown as string) : null,
    }))
  }

  async getSession(
    trx: Tx,
    opts: { orgId: string; sessionId: string },
  ): Promise<StoredSessionDetail | null> {
    const summaryRow = await trx
      .selectFrom('sessions as ses')
      .innerJoin('services as svc', 'svc.id', 'ses.service_id')
      .innerJoin('projects as prj', 'prj.id', 'svc.project_id')
      .where('ses.id', '=', opts.sessionId)
      .where('ses.org_id', '=', opts.orgId)
      .select([
        'ses.id as id',
        'ses.trace_id as traceId',
        'prj.name as projectName',
        'svc.name as serviceName',
        'ses.started_at as startedAt',
        'ses.ended_at as endedAt',
        'ses.step_count as stepCount',
      ])
      .executeTakeFirst()

    if (!summaryRow) return null

    const stepRows = await trx
      .selectFrom('steps')
      .where('session_id', '=', opts.sessionId)
      .selectAll()
      .orderBy('started_at', 'asc')
      .execute()

    const eventRows =
      stepRows.length === 0
        ? []
        : await trx
            .selectFrom('step_events')
            .where(
              'step_id',
              'in',
              stepRows.map((s) => s.id),
            )
            .selectAll()
            .orderBy('ts', 'asc')
            .execute()

    const eventsByStep = new Map<string, StoredStepEvent[]>()
    for (const e of eventRows) {
      const arr = eventsByStep.get(e.step_id) ?? []
      arr.push({
        id: e.id,
        name: e.name,
        ts: new Date(e.ts as unknown as string),
        attributes: (e.attributes ?? {}) as Record<string, unknown>,
      })
      eventsByStep.set(e.step_id, arr)
    }

    const steps: StoredStep[] = stepRows.map((s) => ({
      id: s.id,
      spanId: s.span_id,
      parentSpanId: s.parent_span_id,
      name: s.name,
      kind: s.kind,
      componentType: s.component_type,
      componentName: s.component_name,
      startedAt: new Date(s.started_at as unknown as string),
      endedAt: new Date(s.ended_at as unknown as string),
      attributes: (s.attributes ?? {}) as Record<string, unknown>,
      statusCode: s.status_code,
      statusMessage: s.status_message,
      events: eventsByStep.get(s.id) ?? [],
    }))

    return {
      id: summaryRow.id,
      traceId: summaryRow.traceId,
      projectName: summaryRow.projectName,
      serviceName: summaryRow.serviceName,
      startedAt: new Date(summaryRow.startedAt as unknown as string),
      endedAt: summaryRow.endedAt ? new Date(summaryRow.endedAt as unknown as string) : null,
      stepCount: summaryRow.stepCount,
      steps,
    }
  }

  private async upsertProject(trx: Tx, orgId: string, name: string): Promise<string> {
    const existing = await trx
      .selectFrom('projects')
      .where('org_id', '=', orgId)
      .where('name', '=', name)
      .select('id')
      .executeTakeFirst()
    if (existing) return existing.id

    const inserted = await trx
      .insertInto('projects')
      .values({ org_id: orgId, name })
      .returning('id')
      .executeTakeFirstOrThrow()
    return inserted.id
  }

  private async upsertService(trx: Tx, projectId: string, name: string): Promise<string> {
    const existing = await trx
      .selectFrom('services')
      .where('project_id', '=', projectId)
      .where('name', '=', name)
      .select('id')
      .executeTakeFirst()
    if (existing) return existing.id

    const inserted = await trx
      .insertInto('services')
      .values({ project_id: projectId, name })
      .returning('id')
      .executeTakeFirstOrThrow()
    return inserted.id
  }

  private async upsertSession(
    trx: Tx,
    orgId: string,
    serviceId: string,
    traceId: string,
    startedAt: Date,
    endedAt: Date | null,
  ): Promise<string> {
    const existing = await trx
      .selectFrom('sessions')
      .where('service_id', '=', serviceId)
      .where('trace_id', '=', traceId)
      .select(['id', 'started_at as startedAt', 'ended_at as endedAt'])
      .executeTakeFirst()

    if (existing) {
      const newStart =
        startedAt < new Date(existing.startedAt as unknown as string)
          ? startedAt
          : new Date(existing.startedAt as unknown as string)
      const newEnd =
        endedAt && (!existing.endedAt || endedAt > new Date(existing.endedAt as unknown as string))
          ? endedAt
          : existing.endedAt
            ? new Date(existing.endedAt as unknown as string)
            : null
      await trx
        .updateTable('sessions')
        .set({ started_at: newStart, ended_at: newEnd })
        .where('id', '=', existing.id)
        .execute()
      return existing.id
    }

    const inserted = await trx
      .insertInto('sessions')
      .values({
        org_id: orgId,
        service_id: serviceId,
        trace_id: traceId,
        started_at: startedAt,
        ended_at: endedAt,
      })
      .returning('id')
      .executeTakeFirstOrThrow()
    return inserted.id
  }

  private async upsertStep(
    trx: Tx,
    orgId: string,
    sessionId: string,
    step: NewStep,
  ): Promise<string> {
    const existing = await trx
      .selectFrom('steps')
      .where('session_id', '=', sessionId)
      .where('span_id', '=', step.spanId)
      .select('id')
      .executeTakeFirst()

    const values = {
      org_id: orgId,
      session_id: sessionId,
      span_id: step.spanId,
      parent_span_id: step.parentSpanId,
      name: step.name,
      kind: step.kind,
      component_type: step.componentType,
      component_name: step.componentName,
      started_at: step.startedAt,
      ended_at: step.endedAt,
      attributes: JSON.stringify(step.attributes),
      status_code: step.statusCode,
      status_message: step.statusMessage,
    }

    if (existing) {
      await trx.updateTable('steps').set(values).where('id', '=', existing.id).execute()
      return existing.id
    }

    const inserted = await trx
      .insertInto('steps')
      .values(values)
      .returning('id')
      .executeTakeFirstOrThrow()
    return inserted.id
  }
}
```

> Important: the class no longer holds `this.db`. Every method takes `trx`. The constructor is now parameterless.

### Step 3: Modify `apps/server/test/storage/pg.test.ts` — wrap every call in `withTenantTx`

Read the existing file first to understand the test fixtures. For each `it`/`test` block that calls `storage.X(...)`, wrap in `app.withTenantTx(orgId, trx => storage.X(trx, ...))`. The fixture builds a Fastify app with the `dbTenantPlugin` registered, identical to the audit/withTenantTx tests.

A representative diff: the pattern

```ts
const result = await storage.listSessions({ orgId: ORG_A, limit: 10 })
```

becomes

```ts
const result = await app.withTenantTx(ORG_A, (trx) =>
  storage.listSessions(trx, { orgId: ORG_A, limit: 10 }),
)
```

And the test file's `beforeAll` creates the Fastify app + registers `dbTenantPlugin` once.

### Step 4: typecheck + run storage tests

```bash
pnpm --filter @argus/server typecheck 2>&1 | tail -20
pnpm --filter @argus/server test test/storage/pg.test.ts 2>&1 | tail -20
pnpm --filter @argus/server test test/db-tenant 2>&1 | tail -20
pnpm --filter @argus/server test test/audit 2>&1 | tail -20
```

Expected: typecheck shows errors only in callers not yet updated (`ingest/pipeline.ts`, `pusher/routes.ts`, `api/routes.ts`, `main.ts`, `ingest-grpc/service.ts`). Storage + db-tenant + audit tests all pass.

### Step 5: Commit

```bash
git add apps/server/src/modules/storage apps/server/test/storage/pg.test.ts
git commit -m "feat(server): m7 PgStorage takes Tx; storage tests wrap in withTenantTx"
```

---

## Task 7: Update `ingest` pipeline + HTTP + gRPC routes to use `withTenantTx`

**Files:**

- Modify: `apps/server/src/modules/ingest/pipeline.ts`
- Modify: `apps/server/src/modules/ingest/routes.ts`
- Modify: `apps/server/src/modules/ingest-grpc/service.ts`
- Modify: `apps/server/test/ingest/pipeline.test.ts`
- Modify: `apps/server/test/ingest-grpc/grpc-integration.test.ts`

### Step 1: Modify `apps/server/src/modules/ingest/pipeline.ts`

Replace the full file:

```ts
import type { Tx } from '../db-tenant/index.js'
import type { MessageBus } from '../pubsub/types.js'
import type { StorageBackend, WriteTraceInput } from '../storage/types.js'
import { storedStepToApi } from '../api/mappers.js'

export interface IngestPipelineDeps {
  storage: StorageBackend
  bus: MessageBus
}

export interface IngestPipelineCtx {
  orgId: string
  projectId?: string
  projectName?: string
}

export interface IngestPipelineResult {
  accepted: number
}

/**
 * Write each parsed trace to storage with the caller's orgId stamped onto it,
 * then publish each written step to the bus. The bus publish happens AFTER the
 * tx is otherwise complete (`trx` here is the caller's tx; commit happens when
 * the withTenantTx wrapper resolves). Callers MUST invoke this inside
 * `app.withTenantTx(orgId, trx => processIngestion(trx, traces, ctx, deps))`.
 */
export async function processIngestion(
  trx: Tx,
  traces: WriteTraceInput[],
  ctx: IngestPipelineCtx,
  deps: IngestPipelineDeps,
): Promise<IngestPipelineResult> {
  let accepted = 0
  const toPublish: Array<{ sessionId: string; payload: ReturnType<typeof storedStepToApi> }> = []
  for (const trace of traces) {
    const overridden: WriteTraceInput = {
      ...trace,
      orgId: ctx.orgId,
      projectName: ctx.projectName ?? trace.projectName,
    }
    const result = await deps.storage.writeTrace(trx, overridden)
    for (const stored of result.writtenSteps) {
      toPublish.push({ sessionId: result.sessionId, payload: storedStepToApi(stored) })
    }
    accepted += result.writtenSteps.length
  }
  // Bus publish: queue inside the tx, fire after caller commits. We can't
  // observe commit from here; the simplest correct thing is to publish now and
  // accept that a rare rollback will leak a step over SSE. Real producers don't
  // rely on transactional outbox semantics for this; if needed, add an
  // afterCommit hook later.
  for (const m of toPublish) deps.bus.publish(`session:${m.sessionId}`, m.payload)
  return { accepted }
}
```

### Step 2: Modify `apps/server/src/modules/ingest/routes.ts` — wrap in `withTenantTx`

```ts
import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import type { StorageBackend } from '../storage/types.js'
import type { MessageBus } from '../pubsub/types.js'
import { OtlpParseError, parseOtlpRequest } from './parser.js'
import { otlpExportRequestSchema } from './otlp-json.js'
import { processIngestion } from './pipeline.js'

export interface IngestRoutesDeps {
  storage: StorageBackend
  bus: MessageBus
}

export const ingestRoutes: FastifyPluginAsync<IngestRoutesDeps> = async (
  app: FastifyInstance,
  deps,
) => {
  app.post('/v1/traces', async (request, reply) => {
    const ingest = request.ingest
    if (!ingest) {
      reply.code(401)
      return { error: 'unauthenticated' }
    }

    const parseResult = otlpExportRequestSchema.safeParse(request.body)
    if (!parseResult.success) {
      reply.code(400)
      return { error: 'invalid_otlp_payload', issues: parseResult.error.issues }
    }

    let traces
    try {
      traces = parseOtlpRequest(parseResult.data)
    } catch (err) {
      if (err instanceof OtlpParseError) {
        reply.code(400)
        return { error: 'invalid_otlp_payload', message: err.message }
      }
      throw err
    }

    const { accepted } = await app.withTenantTx(ingest.orgId, (trx) =>
      processIngestion(trx, traces, ingest, deps),
    )
    reply.code(200)
    return { accepted }
  })
}
```

### Step 3: Modify `apps/server/src/modules/ingest-grpc/service.ts` — wrap in `withTenantTx`

The gRPC handler doesn't have a Fastify app instance available the same way. Pass `withTenantTx` via deps:

```ts
import * as grpc from '@grpc/grpc-js'
import type { Kysely } from 'kysely'
import type { DB } from '../../db/schema.js'
import type { Tx } from '../db-tenant/index.js'
import type { MessageBus } from '../pubsub/types.js'
import type { StorageBackend } from '../storage/types.js'
import {
  OtlpParseError,
  otlpExportRequestSchema,
  parseOtlpRequest,
  processIngestion,
} from '../ingest/index.js'
import { DEFAULT_ORG_ID } from '../../constants.js'
import { resolveTokenContext } from '../tokens/index.js'
import { extractBearerToken } from './metadata-auth.js'

export interface TraceServiceDeps {
  db: Kysely<DB>
  storage: StorageBackend
  bus: MessageBus
  mode: 'local' | 'multi-tenant'
  withTenantTx: <T>(orgId: string, fn: (trx: Tx) => Promise<T>) => Promise<T>
}

interface ExportRequest {
  resourceSpans?: unknown
}

interface ExportResponse {
  partialSuccess?: {
    rejectedSpans: string
    errorMessage: string
  }
}

export function makeTraceServiceHandlers(deps: TraceServiceDeps): {
  Export: grpc.handleUnaryCall<ExportRequest, ExportResponse>
} {
  return {
    Export: async (call, callback) => {
      try {
        let orgId = DEFAULT_ORG_ID
        let projectId: string | undefined
        let projectName: string | undefined

        if (deps.mode === 'multi-tenant') {
          const token = extractBearerToken(call.metadata)
          if (!token) {
            callback({ code: grpc.status.UNAUTHENTICATED, message: 'missing_ingest_token' })
            return
          }
          const ctx = await resolveTokenContext(deps.db, token)
          if (!ctx) {
            callback({ code: grpc.status.UNAUTHENTICATED, message: 'invalid_ingest_token' })
            return
          }
          orgId = ctx.orgId
          projectId = ctx.projectId
          projectName = ctx.projectName
        }

        const parsed = otlpExportRequestSchema.safeParse(call.request)
        if (!parsed.success) {
          callback({
            code: grpc.status.INVALID_ARGUMENT,
            message: `invalid_otlp_payload: ${parsed.error.issues[0]?.message ?? 'schema mismatch'}`,
          })
          return
        }

        let traces
        try {
          traces = parseOtlpRequest(parsed.data)
        } catch (err) {
          if (err instanceof OtlpParseError) {
            callback({ code: grpc.status.INVALID_ARGUMENT, message: err.message })
            return
          }
          throw err
        }

        await deps.withTenantTx(orgId, (trx) =>
          processIngestion(
            trx,
            traces,
            { orgId, projectId, projectName },
            { storage: deps.storage, bus: deps.bus },
          ),
        )

        callback(null, {})
      } catch (err) {
        callback({ code: grpc.status.INTERNAL, message: (err as Error).message })
      }
    },
  }
}
```

### Step 4: Modify `apps/server/src/modules/ingest-grpc/index.ts` (or wherever `startGrpcServer` lives) — accept `withTenantTx` in its options and pass through

Read the file first to see the current shape, then add:

```ts
export interface StartGrpcServerOpts {
  host: string
  port: number
  db: Kysely<DB>
  storage: StorageBackend
  bus: MessageBus
  mode: 'local' | 'multi-tenant'
  withTenantTx: <T>(orgId: string, fn: (trx: Tx) => Promise<T>) => Promise<T>
}
```

And forward `withTenantTx` into `makeTraceServiceHandlers`.

### Step 5: Modify `apps/server/test/ingest/pipeline.test.ts`

Wrap every `processIngestion(...)` call in `withTenantTx`. Build the Fastify app + register `dbTenantPlugin` once in `beforeAll`. Example diff:

Old:

```ts
const result = await processIngestion(traces, ctx, { storage, bus })
```

New:

```ts
const result = await app.withTenantTx(ctx.orgId, (trx) =>
  processIngestion(trx, traces, ctx, { storage, bus }),
)
```

### Step 6: Modify `apps/server/test/ingest-grpc/grpc-integration.test.ts`

The integration test boots a real server. The server now exposes `withTenantTx` as an instance decorator; the gRPC wiring needs to forward it. The integration test's setup probably uses `createServer(...)` — that should already pass `withTenantTx` to gRPC after Task 11 (main.ts wiring). For Task 7, make the test work in isolation by:

1. Build the Fastify app via the test's existing path.
2. Pass `app.withTenantTx.bind(app)` as the new `withTenantTx` field to `startGrpcServer`.

Read the file, add the field, run, fix any test-specific shape mismatch.

### Step 7: Typecheck + run

```bash
pnpm --filter @argus/server typecheck 2>&1 | tail -20
pnpm --filter @argus/server test test/ingest 2>&1 | tail -20
pnpm --filter @argus/server test test/ingest-grpc 2>&1 | tail -20
```

Expected: typecheck still has errors in `pusher/routes.ts`, `api/routes.ts`, `auth/routes.ts`, `tokens/routes.ts`, `server.ts`, `main.ts`. Ingest tests pass.

### Step 8: Commit

```bash
git add apps/server/src/modules/ingest \
        apps/server/src/modules/ingest-grpc \
        apps/server/test/ingest \
        apps/server/test/ingest-grpc
git commit -m "feat(server): m7 ingest pipeline + HTTP/gRPC routes wrap in withTenantTx"
```

---

## Task 8: Update `pusher` + `api` routes to use `withTenantTx`

**Files:**

- Modify: `apps/server/src/modules/pusher/routes.ts`
- Modify: `apps/server/src/modules/api/routes.ts`
- Modify: `apps/server/test/pusher/sse.test.ts` (if needed)
- Modify: `apps/server/test/api/routes.test.ts` (if needed)

### Step 1: Read both routes to learn the current shape

```bash
cat apps/server/src/modules/pusher/routes.ts apps/server/src/modules/api/routes.ts
```

### Step 2: Modify each route — wrap storage calls

For every `storage.getSession(...)` and `storage.listSessions(...)`:

```ts
const detail = await deps.storage.getSession({ orgId, sessionId })
```

becomes

```ts
const detail = await request.server.withTenantTx(orgId, (trx) =>
  deps.storage.getSession(trx, { orgId, sessionId }),
)
```

`request.server` is the Fastify instance in a route handler, which has the `withTenantTx` decorator.

> Note: only the public storage methods (`writeTrace` / `listSessions` / `getSession`) need wrapping. Internal helpers are already in a `trx`.

### Step 3: Modify the tests if they directly invoke a fake storage

The existing tests pass a fake storage to the routes. The route now calls `withTenantTx` to get a `trx`, then passes it to the fake. As long as the fake's signature is updated to accept `(trx, opts)`, the tests work. Update those fakes too.

If the SSE integration test uses a real Fastify server, just make sure `dbTenantPlugin` is registered in the test setup (it'll be by Task 11's `createServer` wiring; for Task 8 in isolation, register it inline).

### Step 4: typecheck + run

```bash
pnpm --filter @argus/server typecheck 2>&1 | tail -20
pnpm --filter @argus/server test test/pusher test/api 2>&1 | tail -20
```

Expected: typecheck shows errors in `auth/routes.ts`, `tokens/routes.ts`, `server.ts`, `main.ts` only. Pusher + api tests pass.

### Step 5: Commit

```bash
git add apps/server/src/modules/pusher apps/server/src/modules/api \
        apps/server/test/pusher apps/server/test/api
git commit -m "feat(server): m7 pusher + api routes wrap storage in withTenantTx"
```

---

## Task 9: `auth` routes emit audit events

**Files:**

- Modify: `apps/server/src/modules/auth/routes.ts`
- Modify: `apps/server/test/auth/routes.test.ts`

### Step 1: Read `apps/server/src/modules/auth/routes.ts` to see the current login + register handlers

```bash
cat apps/server/src/modules/auth/routes.ts
```

### Step 2: Modify `auth/routes.ts` — add audit emission

At the top of the file, import the audit module:

```ts
import { record as auditRecord } from '../audit/index.js'
```

In the login handler, on the success branch (after the cookie is set and before returning), insert:

```ts
await app.withTenantTx(record.orgId, (trx) =>
  auditRecord(trx, {
    eventType: 'login_success',
    actorUserId: record.id,
    metadata: { method: 'cookie' },
    ip: request.ip,
    userAgent: request.headers['user-agent'],
  }),
)
```

(Replace `record` with whatever the local variable for the resolved user is in the existing code — usually `user` or `record`.)

In the login handler, on the failure branch (wrong password / unknown email):

```ts
request.log.warn(
  { event: 'login_failure', email, ip: request.ip, userAgent: request.headers['user-agent'] },
  'login_failure',
)
```

In the register handler, after the new user+org is created and cookies are set:

```ts
await app.withTenantTx(newOrgId, (trx) =>
  auditRecord(trx, {
    eventType: 'register',
    actorUserId: newUser.id,
    metadata: { method: 'register' },
    ip: request.ip,
    userAgent: request.headers['user-agent'],
  }),
)
```

(`newOrgId` and `newUser.id` come from whatever the existing register flow returns.)

### Step 3: Update `apps/server/test/auth/routes.test.ts`

Add a test that hits `/auth/login` and `/auth/register` against a server with `dbTenantPlugin` registered, then asserts `audit_log` has the expected rows. (Or rely on the integration test in Task 11 — but having one near-the-source assertion catches regressions earlier.)

```ts
import { describe, expect, test, beforeAll, afterAll, beforeEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import { sql } from 'kysely'
import { authRoutes, resolveAuthContext } from '../../src/modules/auth/index.js'
import { dbTenantPlugin } from '../../src/modules/db-tenant/index.js'
import { createAppRoleTestDb, createTestDb, truncateAll } from '../helpers/db.js'

describe('auth routes — audit emission', () => {
  let app: FastifyInstance
  const appDb = createAppRoleTestDb()
  const admin = createTestDb()
  const JWT_SECRET = 'test-secret-at-least-32-chars-long-x'

  beforeAll(async () => {
    app = Fastify()
    await app.register(cookie)
    await app.register(dbTenantPlugin, { db: appDb })
    const deps = {
      db: appDb,
      mode: 'multi-tenant' as const,
      cookieName: 'argus_session',
      jwtSecret: JWT_SECRET,
    }
    const authMiddleware = resolveAuthContext(deps)
    await app.register(authRoutes, {
      ...deps,
      cookieSecure: false,
      sessionTtlSeconds: 3600,
      authMiddleware,
    })
  })
  beforeEach(async () => {
    await truncateAll(admin)
  })
  afterAll(async () => {
    await app.close()
    await appDb.destroy()
    await admin.destroy()
  })

  test('successful register inserts a register audit row', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'new@a.com', password: 'password123' },
    })
    expect(res.statusCode).toBe(200)
    const rows = await admin.selectFrom('audit_log').selectAll().execute()
    expect(rows).toHaveLength(1)
    expect(rows[0].event_type).toBe('register')
    expect(rows[0].metadata).toEqual({ method: 'register' })
  })

  test('successful login inserts a login_success row', async () => {
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'log@a.com', password: 'password123' },
    })
    await admin.deleteFrom('audit_log').execute() // clear register row
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'log@a.com', password: 'password123' },
    })
    expect(res.statusCode).toBe(200)
    const rows = await admin.selectFrom('audit_log').selectAll().execute()
    expect(rows).toHaveLength(1)
    expect(rows[0].event_type).toBe('login_success')
  })

  test('failed login does NOT insert into audit_log', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'nobody@a.com', password: 'wrong' },
    })
    expect(res.statusCode).toBe(401)
    const rows = await admin.selectFrom('audit_log').selectAll().execute()
    expect(rows).toHaveLength(0)
  })
})
```

### Step 4: typecheck + run

```bash
pnpm --filter @argus/server typecheck 2>&1 | tail -20
pnpm --filter @argus/server test test/auth/routes.test.ts 2>&1 | tail -20
```

Expected: typecheck still red in tokens / server / main. Auth audit tests pass.

### Step 5: Commit

```bash
git add apps/server/src/modules/auth/routes.ts apps/server/test/auth/routes.test.ts
git commit -m "feat(server): m7 auth routes emit audit (login_success, register; login_failure -> log)"
```

---

## Task 10: `tokens` routes emit audit events

**Files:**

- Modify: `apps/server/src/modules/tokens/routes.ts`
- Modify: `apps/server/test/tokens/routes.test.ts`

### Step 1: Read `apps/server/src/modules/tokens/routes.ts` to learn the current handler shape

```bash
cat apps/server/src/modules/tokens/routes.ts
```

### Step 2: Modify `tokens/routes.ts` — add audit emission

Import:

```ts
import { record as auditRecord } from '../audit/index.js'
```

In the `POST /api/tokens` handler, on success (after the token is created):

```ts
const { user } = request.auth
await app.withTenantTx(user.orgId, (trx) =>
  auditRecord(trx, {
    eventType: 'token_create',
    actorUserId: user.id,
    targetKind: 'ingest_token',
    targetId: created.id,
    metadata: { project: created.projectName, name: created.name, prefix: created.prefix },
    ip: request.ip,
    userAgent: request.headers['user-agent'],
  }),
)
```

(`created` is the result of the token CRUD operation in the existing handler; adapt to the actual local-variable name.)

In the `DELETE /api/tokens/:id` handler, after revocation succeeds:

```ts
const { user } = request.auth
await app.withTenantTx(user.orgId, (trx) =>
  auditRecord(trx, {
    eventType: 'token_revoke',
    actorUserId: user.id,
    targetKind: 'ingest_token',
    targetId: revoked.id,
    metadata: { project: revoked.projectName, name: revoked.name, prefix: revoked.prefix },
    ip: request.ip,
    userAgent: request.headers['user-agent'],
  }),
)
```

### Step 3: Modify `apps/server/test/tokens/routes.test.ts` — add audit assertions

After each successful POST / DELETE in the existing tests, query `audit_log` and assert the row.

```ts
test('POST /api/tokens — emits token_create audit row', async () => {
  // existing flow that POSTs a token …
  const rows = await admin.selectFrom('audit_log').selectAll().execute()
  expect(rows).toHaveLength(1)
  expect(rows[0].event_type).toBe('token_create')
  expect(rows[0].target_kind).toBe('ingest_token')
})

test('DELETE /api/tokens/:id — emits token_revoke audit row', async () => {
  // existing flow that POSTs then DELETEs …
  const rows = await admin
    .selectFrom('audit_log')
    .selectAll()
    .where('event_type', '=', 'token_revoke')
    .execute()
  expect(rows).toHaveLength(1)
})
```

### Step 4: typecheck + run

```bash
pnpm --filter @argus/server typecheck 2>&1 | tail -20
pnpm --filter @argus/server test test/tokens 2>&1 | tail -20
```

Expected: only server.ts / main.ts may still have typecheck errors. Tokens tests pass.

### Step 5: Commit

```bash
git add apps/server/src/modules/tokens/routes.ts apps/server/test/tokens/routes.test.ts
git commit -m "feat(server): m7 tokens routes emit audit (token_create, token_revoke)"
```

---

## Task 11: Wire `dbTenantPlugin` into `createServer` + main.ts uses argus_app pool

**Files:**

- Modify: `apps/server/src/env.ts`
- Modify: `apps/server/src/server.ts`
- Modify: `apps/server/src/main.ts`

### Step 1: Modify `apps/server/src/env.ts`

Add `APP_DATABASE_URL` after `DATABASE_URL`. It defaults to `DATABASE_URL` for local dev so the binary boots without env changes.

```ts
const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().url(),
  /** Runtime pool (argus_app role). Defaults to DATABASE_URL with credentials swapped. */
  APP_DATABASE_URL: z.string().url().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  ARGUS_MODE: z.enum(['local', 'multi-tenant']).default('local'),
  JWT_SECRET: z.string().min(32).default('local-dev-secret-not-for-production-x'),
  COOKIE_NAME: z.string().default('argus_session'),
  GRPC_PORT: z.coerce.number().int().min(0).default(4317),
})

export type Env = z.infer<typeof envSchema>

export function loadEnv(env: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.parse(env)
  if (!parsed.APP_DATABASE_URL) {
    const u = new URL(parsed.DATABASE_URL)
    u.username = 'argus_app'
    u.password = process.env.ARGUS_APP_DB_PASSWORD ?? 'argus_app_dev_pwd'
    parsed.APP_DATABASE_URL = u.toString()
  }
  return parsed
}
```

### Step 2: Modify `apps/server/src/server.ts`

Add `appDatabaseUrl: string` to `ServerOptions`. The migration role pool stays at `databaseUrl` (used by migration runner only). The runtime pool uses `appDatabaseUrl`. Register `dbTenantPlugin`.

```ts
import Fastify, { type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import type { Kysely } from 'kysely'
import type { DB } from './db/schema.js'
import { createKysely } from './db/kysely.js'
import { PgStorage } from './modules/storage/pg.js'
import { InProcMessageBus } from './modules/pubsub/index.js'
import type { MessageBus } from './modules/pubsub/types.js'
import { ingestRoutes } from './modules/ingest/index.js'
import { apiRoutes } from './modules/api/index.js'
import { pusherRoutes } from './modules/pusher/index.js'
import { authRoutes, resolveAuthContext, type AuthMiddlewareDeps } from './modules/auth/index.js'
import { resolveIngestContext, tokenManagementRoutes } from './modules/tokens/index.js'
import { dbTenantPlugin } from './modules/db-tenant/index.js'

export interface ServerOptions {
  databaseUrl: string
  appDatabaseUrl: string
  logLevel?: string
  mode: 'local' | 'multi-tenant'
  jwtSecret: string
  cookieName: string
  cookieSecure?: boolean
  sessionTtlSeconds?: number
}

export interface ArgusServer {
  app: FastifyInstance
  db: Kysely<DB>
  bus: MessageBus
}

export async function createServer(opts: ServerOptions): Promise<ArgusServer> {
  const app = Fastify({
    logger: { level: opts.logLevel ?? 'info' },
    bodyLimit: 8 * 1024 * 1024,
  })

  // Runtime pool uses the argus_app role; this is what app code touches.
  const db = createKysely(opts.appDatabaseUrl)
  const storage = new PgStorage()
  const bus = new InProcMessageBus()

  await app.register(cookie)
  await app.register(dbTenantPlugin, { db })

  app.get('/healthz', async () => ({ status: 'ok' }))

  const authDeps: AuthMiddlewareDeps = {
    db,
    mode: opts.mode,
    cookieName: opts.cookieName,
    jwtSecret: opts.jwtSecret,
  }
  const authMiddleware = resolveAuthContext(authDeps)

  await app.register(authRoutes, {
    db,
    cookieName: opts.cookieName,
    jwtSecret: opts.jwtSecret,
    cookieSecure: opts.cookieSecure ?? false,
    sessionTtlSeconds: opts.sessionTtlSeconds ?? 7 * 24 * 3600,
    authMiddleware,
  })

  await app.register(
    async (scope) => {
      scope.addHook('preHandler', authMiddleware)
      await scope.register(apiRoutes, { storage })
      await scope.register(pusherRoutes, { storage, bus })
      await scope.register(tokenManagementRoutes, { db })
    },
    { prefix: '' },
  )

  await app.register(
    async (scope) => {
      scope.addHook('preHandler', resolveIngestContext({ db, mode: opts.mode }))
      await scope.register(ingestRoutes, { storage, bus })
    },
    { prefix: '' },
  )

  app.addHook('onClose', async () => {
    bus.removeAllSubscribers()
    await db.destroy()
  })

  return { app, db, bus }
}
```

### Step 3: Modify `apps/server/src/main.ts`

```ts
import { loadEnv } from './env.js'
import { createServer } from './server.js'
import { startGrpcServer, type StartedGrpcServer } from './modules/ingest-grpc/index.js'

async function main() {
  const env = loadEnv()
  const { app, db, bus } = await createServer({
    databaseUrl: env.DATABASE_URL,
    appDatabaseUrl: env.APP_DATABASE_URL!,
    logLevel: env.LOG_LEVEL,
    mode: env.ARGUS_MODE,
    jwtSecret: env.JWT_SECRET,
    cookieName: env.COOKIE_NAME,
  })

  await app.listen({ port: env.PORT, host: env.HOST })
  app.log.info(`Argus HTTP server listening on http://${env.HOST}:${env.PORT}`)

  let grpc: StartedGrpcServer | undefined
  if (env.GRPC_PORT > 0) {
    const { PgStorage } = await import('./modules/storage/pg.js')
    grpc = await startGrpcServer({
      host: env.HOST,
      port: env.GRPC_PORT,
      db,
      storage: new PgStorage(),
      bus,
      mode: env.ARGUS_MODE,
      withTenantTx: app.withTenantTx.bind(app),
    })
    app.log.info(`Argus gRPC server listening on ${env.HOST}:${grpc.port}`)
  } else {
    app.log.info('Argus gRPC server disabled (GRPC_PORT=0)')
  }

  const shutdown = async () => {
    app.log.info('Shutting down…')
    await Promise.all([app.close(), grpc?.close() ?? Promise.resolve()])
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
```

### Step 4: Modify `apps/server/test/healthz.test.ts` to add `appDatabaseUrl` to the test fixture

```ts
const opts: ServerOptions = {
  databaseUrl: process.env.DATABASE_URL!,
  appDatabaseUrl: appUrl(process.env.DATABASE_URL!),
  // … rest unchanged
}

function appUrl(adminUrl: string): string {
  const u = new URL(adminUrl)
  u.username = 'argus_app'
  u.password = 'argus_app_dev_pwd'
  return u.toString()
}
```

### Step 5: Full pipeline

```bash
pnpm db:up
sleep 5
pnpm typecheck
pnpm lint
pnpm test
```

Expected: 0 errors. Test count ≥ 88 + new ones (estimated +15: 7 db-tenant + 4 audit/record + 4 audit/integration + …).

### Step 6: Commit

```bash
git add apps/server/src/env.ts apps/server/src/server.ts apps/server/src/main.ts \
        apps/server/test/healthz.test.ts
git commit -m "feat(server): m7 createServer wires dbTenantPlugin; runtime pool uses argus_app role"
```

---

## Task 12: Audit log E2E integration test

A single high-level test that boots `createServer`, hits the real routes, asserts `audit_log` reflects them. Catches integration regressions that unit-level audit tests don't.

**Files:**

- Create: `apps/server/test/audit/integration.test.ts`

### Step 1: Create the test file

```ts
import { describe, expect, test, beforeAll, afterAll, beforeEach } from 'vitest'
import { sql } from 'kysely'
import { createServer, type ServerOptions } from '../../src/server.js'
import type { ArgusServer } from '../../src/server.js'
import { createTestDb, createAppRoleTestDb, truncateAll } from '../helpers/db.js'

function appUrl(adminUrl: string): string {
  const u = new URL(adminUrl)
  u.username = 'argus_app'
  u.password = 'argus_app_dev_pwd'
  return u.toString()
}

describe('audit log E2E', () => {
  let server: ArgusServer
  const admin = createTestDb()

  beforeAll(async () => {
    const opts: ServerOptions = {
      databaseUrl: process.env.DATABASE_URL!,
      appDatabaseUrl: appUrl(process.env.DATABASE_URL!),
      logLevel: 'warn',
      mode: 'multi-tenant',
      jwtSecret: 'test-secret-at-least-32-chars-long-x',
      cookieName: 'argus_session',
    }
    server = await createServer(opts)
    await server.app.ready()
  })
  beforeEach(async () => {
    await truncateAll(admin)
  })
  afterAll(async () => {
    await server.app.close()
    await admin.destroy()
  })

  test('register → login → create token → revoke token writes 4 audit rows', async () => {
    // 1. Register
    let res = await server.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'e2e@a.com', password: 'password123' },
    })
    expect(res.statusCode).toBe(200)
    const cookie = res.cookies[0]
    expect(cookie).toBeDefined()

    // 2. Login (separate, to assert two distinct events)
    res = await server.app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'e2e@a.com', password: 'password123' },
    })
    expect(res.statusCode).toBe(200)
    const cookie2 = res.cookies[0]

    // 3. Create token
    res = await server.app.inject({
      method: 'POST',
      url: '/api/tokens',
      headers: { cookie: `${cookie2.name}=${cookie2.value}` },
      payload: { projectName: 'e2e-proj', tokenName: 'e2e-tok' },
    })
    expect(res.statusCode).toBe(200)
    const tokenId = JSON.parse(res.body).id

    // 4. Revoke
    res = await server.app.inject({
      method: 'DELETE',
      url: `/api/tokens/${tokenId}`,
      headers: { cookie: `${cookie2.name}=${cookie2.value}` },
    })
    expect(res.statusCode).toBe(204)

    const rows = await admin
      .selectFrom('audit_log')
      .selectAll()
      .orderBy('timestamp', 'asc')
      .execute()
    expect(rows.map((r) => r.event_type)).toEqual([
      'register',
      'login_success',
      'token_create',
      'token_revoke',
    ])
    expect(rows[2].target_kind).toBe('ingest_token')
    expect(rows[3].target_kind).toBe('ingest_token')
  })

  test('failed login does not insert', async () => {
    const res = await server.app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'never@a.com', password: 'wrong' },
    })
    expect(res.statusCode).toBe(401)
    const rows = await admin.selectFrom('audit_log').selectAll().execute()
    expect(rows).toHaveLength(0)
  })
})
```

### Step 2: Run

```bash
pnpm --filter @argus/server test test/audit/integration.test.ts 2>&1 | tail -30
```

Expected: 2 tests pass. If a route's audit emission is wrong, this catches it.

### Step 3: Commit

```bash
git add apps/server/test/audit/integration.test.ts
git commit -m "test(server): m7 audit log E2E integration coverage"
```

---

## Task 13: CLAUDE.md update + pipeline + tag m7-rls-audit

**Files:**

- Modify: `/Users/fooevr/Code/argus/CLAUDE.md`

### Step 1: Update `CLAUDE.md`

Find the "Common pitfalls" section. Replace the existing line about `org_id`:

OLD:

```
- **Don't add a Postgres query that doesn't filter by `org_id`** — multi-tenant boundary. Use the `withTenant` DAO helper once it exists.
```

NEW:

```
- **All queries against tenant data tables (`projects`, `sessions`, `steps`, `step_events`, `audit_log`) MUST run inside `app.withTenantTx(orgId, trx => ...)`.** RLS is enforced at the DB layer; without the wrapper, SELECTs return 0 rows and INSERT/UPDATE violate `WITH CHECK`. Application-layer `WHERE org_id = ?` clauses are retained for index efficiency + defense in depth.
```

In "Working rules", append:

```
- **Adding a new tenant-data table:** (1) include `org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE`, (2) `ALTER TABLE … ENABLE ROW LEVEL SECURITY; ALTER TABLE … FORCE ROW LEVEL SECURITY`, (3) `CREATE POLICY tenant_isolation … USING/WITH CHECK (org_id = current_setting('argus.current_org_id', true)::uuid)`, (4) `GRANT SELECT, INSERT, UPDATE, DELETE … TO argus_app`, (5) tests for that table wrap in `withTenantTx`.
- **Adding a new audit event:** add the literal to `AuditEventType` in `apps/server/src/modules/audit/types.ts`, call `audit.record(trx, { eventType: 'new_event_type', ... })` at the relevant code path, write an integration test that asserts the row lands.
```

### Step 2: Final full pipeline

```bash
rm -rf apps/server/node_modules
pnpm install
pnpm db:up
sleep 5
pnpm typecheck
pnpm lint
pnpm test
pnpm db:down
pnpm build
```

Expected: all exit 0. Test count ≥ 88 + new tests. Build succeeds.

### Step 3: Tag

```bash
git add CLAUDE.md
git commit -m "docs(claude): m7 multi-tenant RLS rule + audit event how-to"

git tag -a m7-rls-audit -m "M7 RLS + audit log complete

- argus_app PG role (NO BYPASSRLS); migrations stay on super
- ENABLE/FORCE RLS + tenant_isolation policy on projects/sessions/steps/step_events/audit_log
- org_id column added to sessions/steps/step_events (backfilled)
- Fastify decorator app.withTenantTx wraps handlers; set_config sets argus.current_org_id per tx
- audit module: 4 events into table (login_success, register, token_create, token_revoke),
  login_failure to app log
- tenant_isolation integration test proves cross-tenant denial
"
git push origin main
git push origin m7-rls-audit
```

### Step 4: Confirm CI green at https://github.com/tiven-ai/Argus/actions

---

## Acceptance Summary

M7 is done when:

- [ ] `pnpm install / typecheck / lint / test / build` all exit 0
- [ ] All M6 tests (88) still pass; M7 adds at least 15 new ones across `db-tenant/`, `audit/`, `auth/routes.test.ts`, `tokens/routes.test.ts`
- [ ] `argus_app` role exists, NO BYPASSRLS, NO SUPERUSER, NO INHERIT special privileges
- [ ] `projects` / `sessions` / `steps` / `step_events` / `audit_log` all have RLS enabled + `tenant_isolation` policy
- [ ] `sessions` / `steps` / `step_events` now carry `org_id` column with backfill complete + NOT NULL constraint
- [ ] `app.withTenantTx(orgId, fn)` is registered by `dbTenantPlugin`, accessible to every authenticated route
- [ ] Anonymous routes (`/auth/login`, `/auth/register`, healthz) do not require the wrapper but use the argus_app pool (which has SELECT/INSERT on non-RLS tables)
- [ ] Tag `m7-rls-audit` pushed; CI green
- [ ] CLAUDE.md updated so future agents know the rule

Once M7 lands, the remaining backlog narrows to: M8 (email-dependent: verification + password reset), M9 (multi-user-per-org), and minor leftovers (audit UI, SSE reconnect race, responsive layout).
