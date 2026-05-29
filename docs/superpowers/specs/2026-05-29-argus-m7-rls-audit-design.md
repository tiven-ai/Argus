# Argus M7 — PG Row-Level Security + Audit Log (Design Spec)

**Status:** approved 2026-05-29
**Predecessors:** [M0–M6 main spec](2026-05-28-argus-design.md)
**Goal:** Add a database-layer multi-tenant defense (Postgres RLS) and a server-side audit trail for authentication and ingest-token events. Both ship in one milestone because they share the same per-request transaction model.

---

## 1. Success Criteria

M7 is done when all hold:

1. A new PG role `argus_app` (LOGIN, NO BYPASSRLS, NO SUPERUSER) runs every runtime query against tenant data tables.
2. The tables `projects`, `sessions`, `steps`, `span_events`, and the new `audit_log` are protected by `ENABLE/FORCE ROW LEVEL SECURITY` + a `tenant_isolation` policy keyed on the per-transaction GUC `argus.current_org_id`.
3. Every Fastify route that touches tenant data executes inside `app.withTenantTx(orgId, trx => ...)`. Without that wrapper, queries against tenant tables return zero rows or violate `WITH CHECK`.
4. A new module `audit` records exactly five events (`login_success`, `register`, `token_create`, `token_revoke`, plus `login_failure` to the app log only) with actor, target, IP, user-agent, and free-form metadata.
5. Integration test `tenant-isolation` proves that org B cannot read or write org A's data even when SQL is hand-crafted to try.
6. CI: existing 88 tests still pass; M7 adds at least the `tenant-isolation` integration test, the `audit-log` test, and the `withTenantTx` unit test.
7. CLAUDE.md updated so future agents know the new multi-tenant rule.

## 2. Scope

**In:** RLS roles + policies on tenant data tables; per-request transaction wrapper; audit log table; audit log writer; CLAUDE.md update; test coverage.

**Out (Non-Goals):**

- Audit log UI / HTTP API. View via `psql` only this milestone.
- `login_failure` rows in `audit_log`. Logged to app log (`pino`/`console`) because no org context exists.
- Separate `argus_owner` migration role. Migrations continue to run as the existing super-user URL; only the runtime role is added.
- Retention or rotation policy for `audit_log`.
- Alerting / anomaly detection on audit events.
- Multi-user-per-org or org switching (deferred to M9).
- Server-side i18n of audit metadata (English literals).

## 3. Architecture Overview

Two changes interlock:

1. **Connection topology:** Migration `0003_audit_and_rls.ts` creates `argus_app`. App boot (`main.ts`) acquires a Kysely pool using `APP_DATABASE_URL` (argus_app credentials). Migrations continue to use `DATABASE_URL` (super user / existing role). Test fixtures gain a `withAppRoleDb()` helper that mirrors prod.
2. **Per-request transaction:** A Fastify-level decorator `app.withTenantTx<T>(orgId, fn)` wraps the handler. Inside, it issues `SET LOCAL argus.current_org_id = $1` and passes a `Kysely.Transaction<DB>` to the callback. All tenant-data DAOs now accept a `Transaction<DB>` (or a union including it) instead of the bare `Kysely<DB>`.

```
HTTP request
   │
   ▼
Fastify route
   ├─[anonymous: /auth/login,/auth/register]─→ db (no RLS tables touched)
   │
   └─[authenticated]
        │
        ▼
   withTenantTx(request.auth.user.orgId, async trx => {
        await sql`SET LOCAL argus.current_org_id = ${orgId}`.execute(trx)
        // — DAO calls receive `trx` —
        const result = await deps.storage.listSessions({ trx, ... })
        await audit.record(trx, { eventType: 'token_create', ... })
        return result
   })
```

Ingest paths (HTTP `/v1/traces`, gRPC `/v1/traces`) resolve `orgId` from the bearer token via `ingest_tokens` (no RLS), then enter `withTenantTx`.

## 4. RLS Design

### 4.1 Roles

| Role                        | Auth                            | Privileges                                                                                                  | Used by                               |
| --------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `postgres` (existing super) | Set in compose / `DATABASE_URL` | All                                                                                                         | Migrations, local psql, CI test setup |
| `argus_app`                 | Created in migration 0003       | `USAGE` on schema `public`, `SELECT/INSERT/UPDATE/DELETE` on existing + future tables, `USAGE` on sequences | Fastify connection pool at runtime    |

`argus_app` has neither `SUPERUSER` nor `BYPASSRLS`. Migration 0003 also issues `ALTER DEFAULT PRIVILEGES` so any table created by future migrations gets CRUD granted to `argus_app` automatically.

Password: hard-coded as `argus_app_dev_pwd` in the migration body for the dev/test path; overridable via `process.env.ARGUS_APP_DB_PASSWORD` at migration-run time. Local docker-compose runtime URL becomes `APP_DATABASE_URL=postgres://argus_app:argus_app_dev_pwd@localhost:5432/argus`.

### 4.2 Table coverage

**RLS on:** `projects`, `sessions`, `steps`, `span_events`, `audit_log`.

**RLS off:** `users`, `orgs`, `org_members`, `ingest_tokens`. These are read on anonymous code paths (login lookup, token bearer resolution) and have no `org_id` to gate on. They remain application-layer protected.

### 4.3 Policy template

Identical for all five tenant-data tables:

```sql
ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <t> FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON <t>
  USING      (org_id = current_setting('argus.current_org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('argus.current_org_id', true)::uuid);
```

Notes:

- `FORCE ROW LEVEL SECURITY` ensures even the table owner is policy-bound. Prevents accidental bypass if a future code path connects as super user.
- `current_setting('argus.current_org_id', true)` — the second arg is `missing_ok=true`: returns `NULL` if the GUC isn't set. `NULL = uuid` evaluates `unknown` → `false`. So a connection without `SET LOCAL` sees zero rows and cannot insert. Fail-closed by construction.
- A single uniform policy (vs. `FOR SELECT`/`FOR INSERT` splits) is enough because USING + WITH CHECK cover both read and write.

## 5. Per-Request Transaction Model

### 5.1 `app.withTenantTx`

Added as a Fastify decorator. Signature:

```ts
declare module 'fastify' {
  interface FastifyInstance {
    withTenantTx<T>(orgId: string, fn: (trx: Transaction<DB>) => Promise<T>): Promise<T>
  }
}

app.decorate('withTenantTx', async function <
  T,
>(orgId: string, fn: (trx: Transaction<DB>) => Promise<T>): Promise<T> {
  return app.db.transaction().execute(async (trx) => {
    await sql`SET LOCAL argus.current_org_id = ${orgId}`.execute(trx)
    return fn(trx)
  })
})
```

The transaction is rolled back if `fn` throws — Kysely default. SET LOCAL is scoped to the transaction so it never leaks to the next pool acquire.

Implementation lives in `apps/server/src/modules/db-tenant/index.ts` (new module). Export the decorator factory + the `Transaction<DB>` type alias.

### 5.2 DAO signature changes

All tenant-data DAOs change their `db` parameter from `Kysely<DB>` to `Transaction<DB>`. The two existing files are:

- `apps/server/src/modules/storage/dao.ts` — `listSessions`, `getSession`, plus internal helpers.
- `apps/server/src/modules/ingest/pipeline.ts` — `processIngestion`.

Non-tenant-data DAOs (`auth/dao.ts`, `tokens/dao.ts`) keep `Kysely<DB>` because they read/write tables outside RLS.

Existing `WHERE org_id = ?` clauses in DAOs are **retained**:

- Help the planner pick the `(org_id, ...)` composite indexes already declared.
- Application-layer defense in depth — a SET LOCAL bug (wrong orgId passed in) still gets a 0-row read instead of a cross-tenant read.

### 5.3 Anonymous routes

`/auth/login`, `/auth/register`, and any health/version endpoint do **not** call `withTenantTx`. They use `app.db` directly. They only touch RLS-exempt tables (`users`, `orgs`, `org_members`).

Exception: `/auth/login`'s **success path** must record an `audit_log` event, which requires a tx. Implementation: after credentials are verified and `orgId` is resolved, the handler calls `withTenantTx(orgId, trx => audit.record(trx, {...}))`. The login itself stays outside the tx; only the audit write is wrapped.

Same shape for `/auth/register`: create user + org + org_member with `app.db` (no RLS on these tables), then `withTenantTx(newOrgId, trx => audit.record(trx, ...))`.

### 5.4 Ingest routes

Both HTTP `/v1/traces` and gRPC `TraceService.Export`:

1. Resolve token via `tokens/dao` → `orgId, projectId, projectName` (uses `app.db`, no RLS).
2. `await app.withTenantTx(orgId, trx => processIngestion({ trx, request, projectName, ... }))`.
3. `processIngestion` performs `INSERT INTO projects/sessions/steps/span_events` against `trx`. Returns the persisted IDs for the live-push bus.

The pub/sub publish happens **after** the tx commits (so subscribers don't see uncommitted data). The current ordering (DB write then `bus.publish`) is preserved.

## 6. Audit Log

### 6.1 Schema

```sql
CREATE TABLE audit_log (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp       timestamptz NOT NULL DEFAULT now(),
  org_id          uuid        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  actor_user_id   uuid                 REFERENCES users(id) ON DELETE SET NULL,
  event_type      text        NOT NULL,
  target_kind     text,
  target_id       text,
  metadata        jsonb,
  ip              text,
  user_agent      text
);

CREATE INDEX audit_log_org_time_idx ON audit_log (org_id, timestamp DESC);
```

Notes:

- `actor_user_id` is `ON DELETE SET NULL` (not `CASCADE`): when a user is deleted, the audit trail of their actions remains, with NULL actor.
- `target_id` is `text` not `uuid` because some future events may target non-uuid IDs (e.g. an email for a future invite event). For M7's five events, all targets are uuid-shaped.
- `event_type` has no CHECK constraint at DB level — kept open for forward additions. App-side enum `AuditEventType` is the source of truth.

### 6.2 Events recorded

| event_type      | trigger                          | actor_user_id | target_kind    | target_id | metadata                                            |
| --------------- | -------------------------------- | ------------- | -------------- | --------- | --------------------------------------------------- |
| `login_success` | `/auth/login` success            | user.id       | —              | —         | `{ method: 'cookie' }`                              |
| `register`      | `/auth/register` completed       | newUser.id    | —              | —         | `{ method: 'register' }`                            |
| `token_create`  | `POST /api/tokens` success       | user.id       | `ingest_token` | token.id  | `{ project: string, name: string, prefix: string }` |
| `token_revoke`  | `DELETE /api/tokens/:id` success | user.id       | `ingest_token` | token.id  | `{ project: string, name: string, prefix: string }` |

`ip` is `request.ip` (Fastify's resolver — socket IP unless `trustProxy` is set, which it currently is not). `user_agent` is `request.headers['user-agent']` (truncated to ≤ 2048 chars at write time to bound row size).

### 6.3 Writer module

New module `apps/server/src/modules/audit/`:

```
modules/audit/
├── index.ts        — public surface (re-exports record + AuditEventType)
├── types.ts        — AuditEventType union + RecordArgs shape
└── record.ts       — INSERT helper
```

Public API:

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

export async function record(trx: Transaction<DB>, args: RecordArgs): Promise<void>
```

The function inserts one row. `org_id` is **not** an arg — it's inherited from the active `argus.current_org_id` GUC. The INSERT statement reads `current_setting('argus.current_org_id', false)::uuid` (note `missing_ok=false` here: if it isn't set, fail loudly — caller forgot the tx).

### 6.4 `login_failure` handling

`login_failure` events do not go to `audit_log`:

- The failed credential check may not resolve any user (unknown email) → no org context.
- Even when the user exists, writing through a tx that requires a fresh `withTenantTx` for an authentication that just failed adds complexity.

Instead, the auth route logs to the application log (pino) with structured fields:

```
{ level: 'warn', event: 'login_failure', email: <email>, ip, user_agent, reason }
```

The standing log format already used by the server. Aggregation / alerting on these is the ops team's concern.

## 7. Migration `0003_audit_and_rls.ts`

Single migration. Operations, in order, inside one `up()`:

1. `CREATE ROLE argus_app LOGIN PASSWORD :pwd` — `pwd` from `process.env.ARGUS_APP_DB_PASSWORD ?? 'argus_app_dev_pwd'`.
2. `GRANT USAGE ON SCHEMA public TO argus_app`.
3. `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO argus_app`.
4. `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO argus_app`.
5. `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO argus_app` — covers future migrations.
6. `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO argus_app`.
7. `CREATE TABLE audit_log (...)` + `CREATE INDEX audit_log_org_time_idx ...`.
8. For each of `projects`, `sessions`, `steps`, `span_events`, `audit_log`:
   - `ALTER TABLE <t> ENABLE ROW LEVEL SECURITY`
   - `ALTER TABLE <t> FORCE  ROW LEVEL SECURITY`
   - `CREATE POLICY tenant_isolation ON <t> USING (...) WITH CHECK (...)`
9. `GRANT SELECT, INSERT, UPDATE, DELETE ON audit_log TO argus_app` (the bulk GRANT in step 3 happened before audit_log existed).

`down()`: drop policies, drop `audit_log`, revoke + drop role. (The plan will note that down() is rarely used and we don't aggressively test it.)

## 8. Test Strategy

### 8.1 New fixture: `withAppRoleDb()`

Lives in `apps/server/test/fixtures/db.ts`. Returns a Kysely instance connected as `argus_app` (using the just-created credentials). Used by all tenant-data DAO tests instead of the existing super-user `db`.

The existing testcontainers setup keeps using the super user for migration run; only the test's actual queries switch to `argus_app`.

### 8.2 Existing test changes

All current DAO tests that operate on tenant data wrap their work in `withTenantTx(orgId, trx => ...)`. Files touched:

- `apps/server/test/storage/*.test.ts` (existing list)
- `apps/server/test/ingest/pipeline.test.ts`
- `apps/server/test/pusher/sse.test.ts` (if it queries sessions; verify in plan task)

Auth & tokens & healthz tests are unchanged (they touch RLS-exempt tables only, except token tests' org seeding which uses the super-user fixture for setup).

### 8.3 New tests

| File                                                  | Scope                                                                                                                                                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/db-tenant/withTenantTx.test.ts`                 | SET LOCAL takes effect inside tx; var unset after commit/rollback; nested call rejects (or no-ops — plan picks one)                                                                               |
| `test/db-tenant/tenant-isolation.integration.test.ts` | Seed two orgs A,B + one session each. Open tx for A: SELECT sees only A's; INSERT with org_id=A succeeds. Open tx for B: SELECT sees only B's; INSERT with org_id=A raises `RowSecurityViolation` |
| `test/audit/record.test.ts`                           | Writer inserts the correct row for each event_type; missing GUC raises a clear error                                                                                                              |
| `test/audit/integration.test.ts`                      | Hit `/auth/login`, `/auth/register`, POST/DELETE `/api/tokens`, then `SELECT * FROM audit_log` and verify the row count + shape per event                                                         |

## 9. CLAUDE.md Updates

Update the file at `/Users/fooevr/Code/argus/CLAUDE.md` in two places:

### 9.1 Common pitfalls (replace existing rule)

Old line:

> **Don't add a Postgres query that doesn't filter by `org_id`** — multi-tenant boundary. Use the `withTenant` DAO helper once it exists.

New line:

> **All queries against tenant data tables (`projects`, `sessions`, `steps`, `span_events`, `audit_log`) MUST run inside `app.withTenantTx(orgId, trx => ...)`.** RLS is enforced at the DB layer; without the wrapper, SELECTs return 0 rows and INSERT/UPDATE violate `WITH CHECK`. Application-layer `WHERE org_id = ?` clauses are retained for index efficiency + defense in depth.

### 9.2 New working rule (append)

> **Adding a new tenant-data table:** (1) include `org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE`, (2) `ALTER TABLE … ENABLE ROW LEVEL SECURITY; ALTER TABLE … FORCE ROW LEVEL SECURITY`, (3) `CREATE POLICY tenant_isolation … USING/WITH CHECK (org_id = current_setting('argus.current_org_id', true)::uuid)`, (4) `GRANT SELECT, INSERT, UPDATE, DELETE … TO argus_app`, (5) tests for that table wrap in `withTenantTx`.

> **Adding a new audit event:** add the literal to `AuditEventType` in `apps/server/src/modules/audit/types.ts`, call `audit.record(trx, { eventType: 'new_event_type', ... })` at the relevant code path, write an integration test that asserts the row lands.

## 10. Backlog after M7

Carries over to future milestones:

- Email verification + password reset (M8, depends on email provider decision).
- Multi-user-per-org + invite flow (M9).
- Audit log UI viewer + retention.
- Bootstrap role separation (single-role `argus_app` may need splitting if more anonymous data paths land).
- `login_failure` rows in `audit_log` (via SECURITY DEFINER or a separate `system_events` table).
- Forward-compat: if `BYPASSRLS` is needed for some ops tooling (bulk export, migrations that touch data), add a separate `argus_ops` role gated behind explicit opt-in.

---
