# Projects Read API + Backend Session Filtering — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an authoritative `GET /api/projects` endpoint and an optional `?projectId=` filter on `GET /api/sessions`, then switch the frontend project switcher + sessions list to use them — removing the temporary client-side `distinctProjects` dedup.

**Architecture:** Backend gets a small `projects` module (DAO + route) querying the `projects` table under `withTenantTx`, plus a one-line conditional `where` on `storage.listSessions`. Shared Zod types gain `ProjectSummary` / `ListProjectsResponse`. Frontend `lib/api.ts` gains `fetchProjects` and a `projectId` arg on `fetchSessions`; the switcher reads `/api/projects`; the list resolves the active project name→id and filters server-side. The `?project=` URL contract (stores name) is unchanged — id-keying is deferred to sub-project ②.

**Tech Stack:** Fastify + Kysely + Postgres (RLS), Vitest (backend integration tests against a real Postgres), React 19 + TanStack Query, Zod (`@argus/shared-types`).

---

## Source of truth (verified against the code on 2026-05-30)

- **`projects` is under FORCE RLS** (`RLS_TABLES` in `migrations/0003_audit_and_rls.ts:3` includes `projects`). The projects query **must** run inside `withTenantTx` (which sets the `argus.current_org_id` GUC). A direct `deps.db` SELECT as the tokens DAO uses for `ingest_tokens` (not RLS-forced) would return 0 rows for projects. **Do not copy the tokens-DAO direct-db pattern for projects.**
- **Session→project link is via `services`** (no `sessions.project_id`). `storage.listSessions` in `apps/server/src/modules/storage/pg.ts:65` already does `.innerJoin('services as svc', 'svc.id', 'ses.service_id').innerJoin('projects as prj', 'prj.id', 'svc.project_id')` and `.where('ses.org_id','=',opts.orgId)`. Services alias is **`svc`**, projects alias **`prj`**. Add `.where('svc.project_id','=',opts.projectId)` conditionally.
- **`listSessions` opts type is inline** `{ orgId: string; limit?: number }` in both `StorageBackend` (`storage/types.ts:86`) and the impl (`pg.ts:65-68`). No `ListSessionsParams` type exists. `PgStorage` is constructed `new PgStorage()` with no args (it operates on the passed `trx`).
- **`Tx` type:** `import type { Tx } from '../db-tenant/index.js'`. `withTenantTx(orgId, (trx: Tx) => ...)` is decorated onto the Fastify app by `dbTenantPlugin`. `db-tenant/index.js` exports only `dbTenantPlugin`, `DbTenantDeps`, `Tx` (NOT `createDb` or a `DB` type — the `DB` type is `../../src/db/schema.js`).
- **Route registration:** `apps/server/src/server.ts` registers, inside an auth-gated scope (`scope.addHook('preHandler', authMiddleware)`), `apiRoutes` (`{ storage }`), `pusherRoutes` (`{ storage, bus }`), `tokenManagementRoutes` (`{ db }`). Imports are `.js`-suffixed ESM. `apiRoutes`/`tokenManagementRoutes` are `FastifyPluginAsync<Deps>`.
- **Existing route handler shape** (`apps/server/src/modules/api/routes.ts:10`): `if (!request.auth) { reply.code(401); return { error: 'unauthenticated' } }`, `orgId = request.auth.user.orgId`, `await request.server.withTenantTx(orgId, (trx) => ...)`, then map rows to ISO-string DTOs.
- **shared-types** (`packages/shared-types/src/api.ts`): ends at line 54 with `export type GetSessionResponse = ...`. `z` is imported at the top. Barrel `src/index.ts` is `export * from './api.js'`. Rebuild with `pnpm --filter @argus/shared-types build` so consumers see new exports.
- **Backend test harness** (the real pattern, from `apps/server/test/api/routes.test.ts`):
  - `import { createAppRoleTestDb, createTestDb, truncateAll } from '../helpers/db.js'`
  - `createAppRoleTestDb()` → Kysely as the `argus_app` role (RLS-respecting) — use this for the **app's** db so RLS is actually exercised.
  - `createTestDb()` → super-user Kysely — use this only for `truncateAll` and for seeding rows that must bypass RLS.
  - `truncateAll(admin)` truncates data tables and **preserves the default org `00000000-0000-0000-0000-000000000000`**. It deletes all non-default orgs/users.
  - App setup: `app = Fastify(); await app.register(dbTenantPlugin, { db: appDb }); app.addHook('preHandler', async (req) => { req.auth = { user: { id, email, orgId, emailVerifiedAt: null } } }); await app.register(apiRoutes, { storage })`.
  - Seeding: `await app.withTenantTx(ORG, (trx) => storage.writeTrace(trx, {...}))` — `writeTrace` upserts project+service+session. Its input shape is in `routes.test.ts:48-73` (orgId, projectName, serviceName, traceId (32 hex chars), sessionStartedAt, sessionEndedAt, steps[]).
  - The default-org constant used by that test is `const ORG = '00000000-0000-0000-0000-000000000000'`.
- **Frontend `lib/api.ts`** imports `{ GetSessionResponseSchema, ListSessionsResponseSchema, type GetSessionResponse, type ListSessionsResponse } from '@argus/shared-types'`. `fetchSessions()` is `ListSessionsResponseSchema.parse(await fetchJson('/api/sessions'))`. `fetchJson` throws `Error('UNAUTHENTICATED')` on 401.
- **`ProjectSwitcher.tsx:18`** currently: `const { data } = useQuery({ queryKey: ['sessions'], queryFn: fetchSessions, retry: false })` then `const projects = data ? distinctProjects(data.sessions) : []`. The dropdown maps over `projects` (a `string[]` of names) and selection calls `setProject(p)`.
- **`sessions/index.tsx`** (133 lines) currently: `const { data, isLoading, error } = useQuery({ queryKey: ['sessions'], queryFn: fetchSessions, retry: false })`, then `const { project } = useProjectFilter()`, then `const rows = data ? filterSessionsByProject(data.sessions, project) : []`. `project` is the project **name** or null. The empty-state branch is `if (!data || data.sessions.length === 0)`.
- **`sessions-select.ts`** exports `distinctProjects` (first), `filterSessionsByProject`, `adjacentSessions`, `listDurationLabel`. `import type { SessionSummary }` is used by all of them. `distinctProjects` is imported **only** by `ProjectSwitcher`. `sessions-select.test.ts` imports all four and has a `describe('distinctProjects', ...)` block (lines 23-35) plus blocks for the others.

## Commands

- shared-types build: `pnpm --filter @argus/shared-types build`
- one server test file: `pnpm --filter @argus/server exec vitest run test/api/projects.routes.test.ts`
- all server tests: `pnpm --filter @argus/server test`
- web tests: `pnpm --filter @argus/web test`
- typecheck: `pnpm --filter @argus/server typecheck` / `pnpm --filter @argus/web typecheck`
- lint: `pnpm --filter @argus/server lint` / `pnpm --filter @argus/web lint`

> **Backend tests need the test Postgres running** (env `DATABASE_URL` is set by the test global setup). If `pnpm --filter @argus/server test` errors with a connection refusal, bring up the DB the way the repo does (see `README.md` / docker-compose) and re-run. These are real integration tests — do not mock the DB.

Commit trailer on every commit:

```
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

## File structure

| File                                                 | Change | Responsibility                                                                |
| ---------------------------------------------------- | ------ | ----------------------------------------------------------------------------- |
| `packages/shared-types/src/api.ts`                   | modify | Add `ProjectSummarySchema`, `ListProjectsResponseSchema` + inferred types.    |
| `apps/server/src/modules/projects/dao.ts`            | create | `listProjectsForOrg(trx, orgId)` — SELECT id/name/created_at from `projects`. |
| `apps/server/src/modules/projects/routes.ts`         | create | `projectRoutes` (FastifyPluginAsync) — `GET /api/projects`.                   |
| `apps/server/src/modules/projects/index.ts`          | create | Barrel: `export { projectRoutes } from './routes.js'`.                        |
| `apps/server/src/server.ts`                          | modify | Import + register `projectRoutes` in the auth-gated scope.                    |
| `apps/server/src/modules/storage/types.ts`           | modify | `listSessions` opts gain `projectId?: string`.                                |
| `apps/server/src/modules/storage/pg.ts`              | modify | Conditional `.where('svc.project_id','=',projectId)`.                         |
| `apps/server/src/modules/api/routes.ts`              | modify | Parse `?projectId`, pass to `listSessions`.                                   |
| `apps/server/test/api/projects.routes.test.ts`       | create | 401 / list / tenant-isolation tests.                                          |
| `apps/server/test/api/routes.test.ts`                | modify | Add `?projectId` filter test.                                                 |
| `apps/web/src/lib/api.ts`                            | modify | Add `fetchProjects`; `fetchSessions(projectId?)`.                             |
| `apps/web/src/components/layout/ProjectSwitcher.tsx` | modify | Read `/api/projects` instead of deriving from sessions.                       |
| `apps/web/src/routes/sessions/index.tsx`             | modify | Resolve name→id; server-side filter via `fetchSessions(projectId)`.           |
| `apps/web/src/lib/sessions-select.ts`                | modify | Delete orphaned `distinctProjects`.                                           |
| `apps/web/src/lib/sessions-select.test.ts`           | modify | Delete the `distinctProjects` test block + import.                            |

## Out of scope (sub-projects ② / ③)

Path scope `/p/$projectId`; storing an id in `?project=`; "All projects" as a landing page; project create/rename/delete + Settings management page + cascade-delete design + audit events. Do not implement these here.

---

## Task 1: shared-types — ProjectSummary + ListProjectsResponse

**Files:**

- Modify: `packages/shared-types/src/api.ts`

- [ ] **Step 1: Append the schemas + types**

At the very end of `packages/shared-types/src/api.ts` (after the existing `export type GetSessionResponse = ...` line), append:

```ts
export const ProjectSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
})

export const ListProjectsResponseSchema = z.object({
  projects: z.array(ProjectSummarySchema),
})

export type ProjectSummary = z.infer<typeof ProjectSummarySchema>
export type ListProjectsResponse = z.infer<typeof ListProjectsResponseSchema>
```

(`z` is already imported at the top — do not re-import.)

- [ ] **Step 2: Build shared-types so consumers see the new exports**

Run: `pnpm --filter @argus/shared-types build`
Expected: success, no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/shared-types/src/api.ts
git commit -m "$(cat <<'EOF'
feat(shared-types): ProjectSummary + ListProjectsResponse schemas

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Backend — projects DAO + `GET /api/projects` route + registration

**Files:**

- Create: `apps/server/src/modules/projects/dao.ts`, `routes.ts`, `index.ts`
- Modify: `apps/server/src/server.ts`
- Test: `apps/server/test/api/projects.routes.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/server/test/api/projects.routes.test.ts`. This mirrors `test/api/routes.test.ts`'s harness exactly (app on the `argus_app` role; super-user `admin` for truncate + cross-org seeding; default org constant). It seeds two non-default orgs because `truncateAll` only preserves the default org and we need a clean two-org isolation check.

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import type { Kysely } from 'kysely'
import type { DB } from '../../src/db/schema.js'
import { dbTenantPlugin } from '../../src/modules/db-tenant/index.js'
import { projectRoutes } from '../../src/modules/projects/index.js'
import { createAppRoleTestDb, createTestDb, truncateAll } from '../helpers/db.js'

const ORG_A = '00000000-0000-0000-0000-0000000000aa'
const ORG_B = '00000000-0000-0000-0000-0000000000bb'

describe('GET /api/projects', () => {
  let appDb: Kysely<DB>
  let admin: Kysely<DB>
  let app: FastifyInstance
  let authedOrgId: string

  beforeAll(async () => {
    appDb = createAppRoleTestDb()
    admin = createTestDb()
    app = Fastify()
    await app.register(dbTenantPlugin, { db: appDb })
    app.addHook('preHandler', async (req) => {
      if (authedOrgId) {
        req.auth = { user: { id: 'u', email: 'e', orgId: authedOrgId, emailVerifiedAt: null } }
      }
    })
    await app.register(projectRoutes)
  })

  beforeEach(async () => {
    await truncateAll(admin)
    await admin
      .insertInto('orgs')
      .values([
        { id: ORG_A, name: 'org-a' },
        { id: ORG_B, name: 'org-b' },
      ])
      .execute()
  })

  afterAll(async () => {
    await app.close()
    await appDb.destroy()
    await admin.destroy()
  })

  async function seedProjects(orgId: string, names: string[]): Promise<void> {
    await admin
      .insertInto('projects')
      .values(names.map((name) => ({ org_id: orgId, name })))
      .execute()
  }

  it('returns 401 when unauthenticated', async () => {
    authedOrgId = ''
    const res = await app.inject({ method: 'GET', url: '/api/projects' })
    expect(res.statusCode).toBe(401)
  })

  it('lists the authed org projects ordered by name', async () => {
    authedOrgId = ORG_A
    await seedProjects(ORG_A, ['beta', 'alpha'])
    const res = await app.inject({ method: 'GET', url: '/api/projects' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { projects: Array<{ id: string; name: string; createdAt: string }> }
    expect(body.projects.map((p) => p.name)).toEqual(['alpha', 'beta'])
    expect(typeof body.projects[0]!.id).toBe('string')
    expect(typeof body.projects[0]!.createdAt).toBe('string')
  })

  it('does not leak another org projects (tenant isolation)', async () => {
    authedOrgId = ORG_B
    await seedProjects(ORG_A, ['secret-a'])
    const res = await app.inject({ method: 'GET', url: '/api/projects' })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { projects: unknown[] }).projects).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run it — expect FAIL (module not found)**

Run: `pnpm --filter @argus/server exec vitest run test/api/projects.routes.test.ts`
Expected: FAIL — cannot resolve `../../src/modules/projects/index.js`.

- [ ] **Step 3: Create the DAO**

Create `apps/server/src/modules/projects/dao.ts`:

```ts
import type { Tx } from '../db-tenant/index.js'

export interface ProjectRow {
  id: string
  name: string
  createdAt: Date
}

/** Lists an org's projects, ordered by name. MUST run inside withTenantTx —
 * the projects table is under FORCE RLS. */
export async function listProjectsForOrg(trx: Tx, orgId: string): Promise<ProjectRow[]> {
  const rows = await trx
    .selectFrom('projects')
    .where('org_id', '=', orgId)
    .select(['id as id', 'name as name', 'created_at as createdAt'])
    .orderBy('name')
    .execute()
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    createdAt: new Date(r.createdAt as unknown as string),
  }))
}
```

- [ ] **Step 4: Create the route**

Create `apps/server/src/modules/projects/routes.ts`:

```ts
import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import { listProjectsForOrg } from './dao.js'

export const projectRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get('/api/projects', async (request, reply) => {
    if (!request.auth) {
      reply.code(401)
      return { error: 'unauthenticated' }
    }
    const orgId = request.auth.user.orgId
    const projects = await request.server.withTenantTx(orgId, (trx) =>
      listProjectsForOrg(trx, orgId),
    )
    return {
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        createdAt: p.createdAt.toISOString(),
      })),
    }
  })
}
```

- [ ] **Step 5: Create the barrel**

Create `apps/server/src/modules/projects/index.ts`:

```ts
export { projectRoutes } from './routes.js'
```

- [ ] **Step 6: Run the test — expect PASS**

Run: `pnpm --filter @argus/server exec vitest run test/api/projects.routes.test.ts`
Expected: PASS (3 tests). If it errors on DB connection, start the test Postgres (see Commands) and retry.

- [ ] **Step 7: Register the route in the app**

In `apps/server/src/server.ts`, add the import after the `tokenManagementRoutes` import line (line 13):

```ts
import { projectRoutes } from './modules/projects/index.js'
```

And register it inside the auth-gated scope, after `tokenManagementRoutes` (line 110):

```ts
await scope.register(tokenManagementRoutes, { db })
await scope.register(projectRoutes)
```

- [ ] **Step 8: Typecheck + lint**

Run: `pnpm --filter @argus/server typecheck && pnpm --filter @argus/server lint`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/server/src/modules/projects/ apps/server/src/server.ts apps/server/test/api/projects.routes.test.ts
git commit -m "$(cat <<'EOF'
feat(server): GET /api/projects (tenant-scoped project list)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Backend — optional `?projectId=` filter on `GET /api/sessions`

**Files:**

- Modify: `apps/server/src/modules/storage/types.ts`, `apps/server/src/modules/storage/pg.ts`, `apps/server/src/modules/api/routes.ts`
- Test: `apps/server/test/api/routes.test.ts`

- [ ] **Step 1: Add the failing test**

In `apps/server/test/api/routes.test.ts`, add this test inside the `describe('Query API routes', ...)` block, after the existing `'GET /api/sessions/:id returns 404 for unknown id'` test. It writes two sessions under the default `ORG` (the file's existing constant) into two different projects, looks up one project's id, and asserts the filter narrows results:

```ts
it('GET /api/sessions?projectId filters to one project', async () => {
  const base = {
    orgId: ORG,
    serviceName: 's1',
    sessionStartedAt: new Date('2026-05-28T12:00:00Z'),
    sessionEndedAt: new Date('2026-05-28T12:00:01Z'),
    steps: [],
  }
  await app.withTenantTx(ORG, (trx) =>
    storage.writeTrace(trx, { ...base, projectName: 'proj-one', traceId: '1'.repeat(32) }),
  )
  await app.withTenantTx(ORG, (trx) =>
    storage.writeTrace(trx, { ...base, projectName: 'proj-two', traceId: '2'.repeat(32) }),
  )

  const projects = await app.withTenantTx(ORG, (trx) =>
    trx.selectFrom('projects').select(['id', 'name']).execute(),
  )
  const oneId = projects.find((p) => p.name === 'proj-one')!.id

  const filtered = await app.inject({ method: 'GET', url: `/api/sessions?projectId=${oneId}` })
  expect(filtered.statusCode).toBe(200)
  const fb = ListSessionsResponseSchema.parse(filtered.json())
  expect(fb.sessions).toHaveLength(1)
  expect(fb.sessions[0]?.projectName).toBe('proj-one')

  const all = await app.inject({ method: 'GET', url: '/api/sessions' })
  expect(ListSessionsResponseSchema.parse(all.json()).sessions).toHaveLength(2)
})
```

(Note: `ListSessionsResponseSchema` and `ORG`/`storage`/`app` are already in scope in this file.)

- [ ] **Step 2: Run it — expect FAIL**

Run: `pnpm --filter @argus/server exec vitest run test/api/routes.test.ts`
Expected: FAIL — the filtered request returns 2 sessions (filter not implemented), so `toHaveLength(1)` fails.

- [ ] **Step 3: Widen the storage interface type**

In `apps/server/src/modules/storage/types.ts`, change the `listSessions` signature in the `StorageBackend` interface (line 86):

```ts
  listSessions(
    trx: Tx,
    opts: { orgId: string; projectId?: string; limit?: number },
  ): Promise<StoredSessionSummary[]>
```

- [ ] **Step 4: Apply the filter in the impl**

In `apps/server/src/modules/storage/pg.ts`, replace the `listSessions` method (lines 65-93) with this version — opts type widened, query built conditionally so the `?projectId` `where` is appended only when present:

```ts
  async listSessions(
    trx: Tx,
    opts: { orgId: string; projectId?: string; limit?: number },
  ): Promise<StoredSessionSummary[]> {
    const limit = opts.limit ?? 50
    let qb = trx
      .selectFrom('sessions as ses')
      .innerJoin('services as svc', 'svc.id', 'ses.service_id')
      .innerJoin('projects as prj', 'prj.id', 'svc.project_id')
      .where('ses.org_id', '=', opts.orgId)
    if (opts.projectId) {
      qb = qb.where('svc.project_id', '=', opts.projectId)
    }
    const rows = await qb
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
```

- [ ] **Step 5: Pass the query param through the route**

In `apps/server/src/modules/api/routes.ts`, in the `GET /api/sessions` handler (lines 15-20), change the query parsing + the `listSessions` call:

```ts
const query = request.query as { limit?: string; projectId?: string }
const limit = query.limit ? Math.min(200, Math.max(1, parseInt(query.limit, 10))) : 50
const orgId = request.auth.user.orgId
const sessions = await request.server.withTenantTx(orgId, (trx) =>
  deps.storage.listSessions(trx, { orgId, projectId: query.projectId, limit }),
)
```

- [ ] **Step 6: Run the test — expect PASS**

Run: `pnpm --filter @argus/server exec vitest run test/api/routes.test.ts`
Expected: PASS (all tests including the new filter test).

- [ ] **Step 7: Full server suite + typecheck + lint**

Run: `pnpm --filter @argus/server test && pnpm --filter @argus/server typecheck && pnpm --filter @argus/server lint`
Expected: all PASS (no regressions in `test/storage/pg.test.ts`, which calls `listSessions` — the new opts field is optional so existing calls still compile).

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/modules/storage/types.ts apps/server/src/modules/storage/pg.ts apps/server/src/modules/api/routes.ts apps/server/test/api/routes.test.ts
git commit -m "$(cat <<'EOF'
feat(server): optional projectId filter on GET /api/sessions

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Frontend — `fetchProjects` + `fetchSessions(projectId)`

**Files:**

- Modify: `apps/web/src/lib/api.ts`

- [ ] **Step 1: Update the shared-types import**

In `apps/web/src/lib/api.ts`, change the `@argus/shared-types` import block (lines 1-6) to also pull the project schema + type:

```ts
import {
  GetSessionResponseSchema,
  ListSessionsResponseSchema,
  ListProjectsResponseSchema,
  type GetSessionResponse,
  type ListSessionsResponse,
  type ListProjectsResponse,
} from '@argus/shared-types'
```

- [ ] **Step 2: Replace `fetchSessions` and add `fetchProjects`**

Replace the existing `fetchSessions` function (currently `export async function fetchSessions(): Promise<ListSessionsResponse> { return ListSessionsResponseSchema.parse(await fetchJson('/api/sessions')) }`) with:

```ts
export async function fetchSessions(projectId?: string): Promise<ListSessionsResponse> {
  const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''
  return ListSessionsResponseSchema.parse(await fetchJson(`/api/sessions${qs}`))
}

export async function fetchProjects(): Promise<ListProjectsResponse> {
  return ListProjectsResponseSchema.parse(await fetchJson('/api/projects'))
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @argus/web typecheck`
Expected: PASS. (Existing `useQuery({ queryFn: fetchSessions })` callers still typecheck — the new param is optional and TanStack passes a context arg that the function ignores, exactly as before.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/api.ts
git commit -m "$(cat <<'EOF'
feat(web): fetchProjects + optional projectId on fetchSessions

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Frontend — ProjectSwitcher reads `/api/projects`; delete orphaned `distinctProjects`

**Files:**

- Modify: `apps/web/src/components/layout/ProjectSwitcher.tsx`, `apps/web/src/lib/sessions-select.ts`, `apps/web/src/lib/sessions-select.test.ts`

- [ ] **Step 1: Switch the data source in ProjectSwitcher**

In `apps/web/src/components/layout/ProjectSwitcher.tsx`:

(a) Replace the two imports

```ts
import { fetchSessions } from '@/lib/api'
import { distinctProjects } from '@/lib/sessions-select'
```

with

```ts
import { fetchProjects } from '@/lib/api'
```

(b) Replace the query + derivation (lines 18-19)

```ts
const { data } = useQuery({ queryKey: ['sessions'], queryFn: fetchSessions, retry: false })
const projects = data ? distinctProjects(data.sessions) : []
```

with

```ts
const { data } = useQuery({ queryKey: ['projects'], queryFn: fetchProjects, retry: false })
const projects = data ? data.projects.map((p) => p.name) : []
```

Everything else stays — `projects` is still `string[]` of names; selection still calls `setProject(p)` with a name (unchanged `?project=` contract).

- [ ] **Step 2: Confirm `distinctProjects` is now unused**

Run: `grep -rn "distinctProjects" apps/web/src`
Expected: matches **only** in `sessions-select.ts` (definition) and `sessions-select.test.ts` (its test). If anything else still references it, stop and report — do not delete.

- [ ] **Step 3: Delete the orphaned function**

In `apps/web/src/lib/sessions-select.ts`, delete the first export (lines 3-5):

```ts
export function distinctProjects(sessions: SessionSummary[]): string[] {
  return [...new Set(sessions.map((s) => s.projectName))].sort((a, b) => a.localeCompare(b))
}
```

Keep `filterSessionsByProject`, `adjacentSessions`, `listDurationLabel`, and the `import type { SessionSummary }` line (still used by the survivors).

- [ ] **Step 4: Delete its test block + import**

In `apps/web/src/lib/sessions-select.test.ts`:

(a) Change the import (lines 2-7) from

```ts
import {
  distinctProjects,
  filterSessionsByProject,
  adjacentSessions,
  listDurationLabel,
} from './sessions-select'
```

to

```ts
import { filterSessionsByProject, adjacentSessions, listDurationLabel } from './sessions-select'
```

(b) Delete the entire `describe('distinctProjects', () => { ... })` block (lines 23-35):

```ts
describe('distinctProjects', () => {
  it('returns sorted unique project names', () => {
    const list = [
      s({ projectName: 'beta' }),
      s({ projectName: 'alpha' }),
      s({ projectName: 'beta' }),
    ]
    expect(distinctProjects(list)).toEqual(['alpha', 'beta'])
  })
  it('handles empty input', () => {
    expect(distinctProjects([])).toEqual([])
  })
})
```

- [ ] **Step 5: Test + typecheck + lint**

Run: `pnpm --filter @argus/web test && pnpm --filter @argus/web typecheck && pnpm --filter @argus/web lint`
Expected: PASS (remaining sessions-select tests green; no unused-import errors).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/layout/ProjectSwitcher.tsx apps/web/src/lib/sessions-select.ts apps/web/src/lib/sessions-select.test.ts
git commit -m "$(cat <<'EOF'
feat(web): ProjectSwitcher reads /api/projects; drop client dedup

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Frontend — sessions list filters server-side via name→id resolution

**Files:**

- Modify: `apps/web/src/routes/sessions/index.tsx`

- [ ] **Step 1: Update the api import**

In `apps/web/src/routes/sessions/index.tsx`, change the api import (line 5) from

```ts
import { fetchSessions } from '../../lib/api'
```

to

```ts
import { fetchProjects, fetchSessions } from '../../lib/api'
```

Leave the `filterSessionsByProject, listDurationLabel` import (line 8) as-is — both still used.

- [ ] **Step 2: Resolve name→id and filter server-side**

Replace the query + derivation block (lines 21-27):

```ts
const { data, isLoading, error } = useQuery({
  queryKey: ['sessions'],
  queryFn: fetchSessions,
  retry: false,
})
const { project } = useProjectFilter()
const rows = data ? filterSessionsByProject(data.sessions, project) : []
```

with:

```ts
const { project } = useProjectFilter()
const { data: projectsData } = useQuery({
  queryKey: ['projects'],
  queryFn: fetchProjects,
  retry: false,
})
const projectId =
  project && projectsData ? projectsData.projects.find((p) => p.name === project)?.id : undefined
const { data, isLoading, error } = useQuery({
  queryKey: ['sessions', projectId ?? null],
  queryFn: () => fetchSessions(projectId),
  retry: false,
})
const rows = data ? filterSessionsByProject(data.sessions, project) : []
```

Rationale (per spec): when `projectId` resolves, the server returns only that project's sessions and `filterSessionsByProject(name)` is a no-op; before projects load, `fetchSessions(undefined)` returns all and the client filter narrows by name. Both converge on the same rows.

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm --filter @argus/web typecheck && pnpm --filter @argus/web lint`
Expected: PASS.

- [ ] **Step 4: Visual verification (dev server)**

With the app running (`pnpm dev`) and logged in: the sidebar project switcher lists real projects from `/api/projects`. Pick a project → URL gets `?project=<name>`, the network panel shows `GET /api/sessions?projectId=<uuid>`, and the list shows only that project's sessions (Project column hidden). Pick "All projects" → `GET /api/sessions` with no query, full list. (If preview tooling is unavailable, confirm via the running dev server's network panel.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/sessions/index.tsx
git commit -m "$(cat <<'EOF'
feat(web): sessions list filters server-side via /api/projects id

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final verification

- [ ] `pnpm --filter @argus/shared-types build` → success.
- [ ] `pnpm --filter @argus/server test` → all pass (projects routes + sessions filter + no regressions). Needs test Postgres up.
- [ ] `pnpm --filter @argus/server typecheck && pnpm --filter @argus/server lint` → clean.
- [ ] `pnpm --filter @argus/web test && pnpm --filter @argus/web typecheck && pnpm --filter @argus/web lint` → clean (no orphaned `distinctProjects`).
- [ ] `pnpm --filter @argus/web build` → success.
- [ ] Manual: project switcher populated from `/api/projects`; selecting a project issues `?projectId=` and filters server-side; "All projects" clears it.

---

## Self-review (completed by plan author)

- **Spec coverage:** `GET /api/projects` (T2) ✓; `?projectId` on sessions (T3) ✓; shared-types schemas (T1) ✓; `fetchProjects` + `fetchSessions(projectId)` (T4) ✓; ProjectSwitcher uses the endpoint (T5) ✓; `?project=` keeps storing name + frontend name→id bridge (T6) ✓; delete orphaned `distinctProjects` + test (T5) ✓; backend tests for 401/list/isolation/filter (T2, T3) ✓; `filterSessionsByProject`/`adjacentSessions`/`listDurationLabel` kept (T5) ✓.
- **Test-harness correctness (the part I got wrong first and verified):** the api tests use `createAppRoleTestDb()` for the app (so RLS is exercised) + `createTestDb()` super-user for `truncateAll`/seeding, NOT `createDb`/`dbTenantPlugin({db})`. `truncateAll` preserves only the default org, so the isolation test seeds `ORG_A`/`ORG_B` via the admin connection. `projectRoutes` is registered with no deps object. `PgStorage` is `new PgStorage()`. These match `test/api/routes.test.ts` exactly.
- **RLS correctness:** the projects query runs in `withTenantTx` (T2 DAO comment + route), required because `projects` is FORCE RLS. The session filter uses `svc.project_id` on the already-joined `services` alias (T3), matching the real `pg.ts` (aliases `svc`/`prj`, verified).
- **Type consistency:** `listSessions` opts `{ orgId, projectId?, limit? }` identical in `types.ts` (T3.3) and `pg.ts` (T3.4); `ProjectRow {id,name,createdAt:Date}` (DAO) → wire DTO `{id,name,createdAt:ISO}` (route) → matches `ProjectSummarySchema` (T1); `fetchProjects(): Promise<ListProjectsResponse>` consumed as `data.projects` in T5/T6; sessions queryKey becomes `['sessions', projectId ?? null]` (T6) — switcher uses `['projects']`, no key collision.
- **Placeholder scan:** none — every code step has complete code; no TBD/TODO.
- **Deliberate edge case (noted, not a gap):** selecting a project with zero sessions falls into the existing onboarding empty-state (`!data || data.sessions.length === 0`). Acceptable for ①.
