# Project CRUD + Settings Management — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add create / rename / delete for projects (backend routes + audit) and a Settings → Projects management page, with destructive delete gated behind type-the-name confirmation.

**Architecture:** Three new routes (POST/PATCH/DELETE) on the existing `projectRoutes` plugin, each wrapping a DAO call + an audit `record()` in one `withTenantTx`. Delete relies on the DB's `ON DELETE CASCADE` (project → services → sessions → steps → step_events, plus ingest_tokens). Frontend gets `lib/api.ts` wrappers and a new `/settings/projects` page; deleting the active project resets the id-keyed filter.

**Tech Stack:** Fastify + Kysely + Postgres (RLS), Zod, Vitest; React 19 + TanStack Router/Query, react-i18next.

---

## Source of truth (verified against the code on 2026-05-31)

- **`AuditEventType` does NOT yet include project events.** It is `'login_success' | 'register' | 'token_create' | 'token_revoke'` (`apps/server/src/modules/audit/types.ts:1`). The plan ADDS `'project_create' | 'project_rename' | 'project_delete'`. (The spec's claim that these already exist was wrong; corrected here.)
- **`audit.record(trx, args)`** (`apps/server/src/modules/audit/record.ts`): reads the org from the `argus.current_org_id` GUC (set by `withTenantTx`); throws if the GUC is unset. `RecordArgs = { eventType, actorUserId, targetKind?, targetId?, metadata?, ip?, userAgent? }`. `metadata` is JSON-stringified in and returned as a parsed object by Kysely (the tokens test asserts `metadata` deep-equals an object). Import via `import { record } from '../audit/index.js'`.
- **`ProjectSummarySchema` is `{ id, name }` — no `createdAt`** (`packages/shared-types/src/api.ts:49`). The GET route already emits `createdAt`, but the frontend's `ListProjectsResponseSchema.parse` strips it. The plan adds `createdAt: z.string()` so the Projects page can show a created date. `ProjectSummary`, `ListProjectsResponse` are exported at the file tail.
- **Cascade is DB-handled.** `DELETE FROM projects WHERE id` cascades via `ON DELETE CASCADE`: `services.project_id` → `sessions.service_id` → `steps.session_id` → `step_events.step_id`, plus `ingest_tokens.project_id`. `sessions`/`steps`/`step_events` also have their own `org_id` column (added in migration 0003) — irrelevant to delete, but relevant when seeding test data directly. Easiest seeding is `storage.writeTrace`, which builds the whole project→service→session→steps→events tree.
- **`projects` unique constraint** `projects_org_name_unique (org_id, name)`. RLS FORCE on `projects`; all queries run in `withTenantTx`.
- **`projectRoutes`** (`apps/server/src/modules/projects/routes.ts`) is `FastifyPluginAsync` with **no deps**; only `GET /api/projects`. Registered in `server.ts:112` as `await scope.register(projectRoutes)` inside the auth-gated scope. The new routes need NO deps (audit + DAO both run on `trx` via `request.server.withTenantTx`), so registration is unchanged.
- **`projects/dao.ts`** exports `listProjectsForOrg(trx, orgId)` returning `ProjectRow { id, name, createdAt: Date }`.
- **Route handler shape** (tokens): 401 if `!request.auth`; zod `safeParse` body → 400 `{ error: 'invalid_input', issues }`; `request.server.withTenantTx(orgId, async (trx) => { ...dao + record... })`; ownership-miss → 404. `app.delete<{ Params: { id: string } }>('/api/tokens/:id', ...)` is the params-typing pattern.
- **Existing backend test** `apps/server/test/api/projects.routes.test.ts`: `describe('GET /api/projects', ...)` with `appDb = createAppRoleTestDb()` (RLS app role), `admin = createTestDb()` (super-user), `truncateAll(admin)` + seed `ORG_A`/`ORG_B` orgs in `beforeEach`, a `seedProjects(orgId, names[])` helper (admin inserts), an `authedOrgId` toggle in the `preHandler`, and `await app.register(projectRoutes)`. The plan RENAMES the describe to `'project routes'` and adds POST/PATCH/DELETE tests inside it (sharing the setup). For the cascade test, import `PgStorage` and `storage = new PgStorage()` and seed via `app.withTenantTx(ORG_A, (trx) => storage.writeTrace(trx, {...}))`.
- **Frontend `lib/api.ts`**: `fetchJson` throws `new Error('UNAUTHENTICATED')` on 401 and `new Error('HTTP <status> on <url>')` otherwise (so a 409 surfaces as an `Error` whose message contains `HTTP 409`). `fetchProjects()` parses `ListProjectsResponseSchema`. Imports from `@argus/shared-types` at the top.
- **`nav-config.ts`** `SETTINGS_NAV`: `tokens` (real), `members`/`general`/`integrations` (`soon`). `NavEntry.to` is typed `string` (so adding an entry with `to: '/settings/projects'` compiles even before the route exists — only `createFileRoute('/settings/projects')` in the page file requires the regenerated route tree). Icons imported from `lucide-react`.
- **`routes/settings/tokens.tsx`** is the page pattern: `createFileRoute('/settings/tokens')`, `useQuery` + `useMutation` + `queryClient.invalidateQueries`, `inputClass` constant, `useLocaleFormat` for dates.
- **`useProjectFilter()`** (post-②): returns `{ project: string|null (an id), setProject(id|null) }`.
- **Routing is file-based** via `@tanstack/router-plugin/vite`. Adding `routes/settings/projects.tsx` requires regenerating `apps/web/src/routeTree.gen.ts`. `vite build` regenerates it (the plugin's buildStart hook) without running `tsc` first (unlike `pnpm build` = `tsc -b && vite build`). **This is the one feature where `routeTree.gen.ts` IS committed** (a real new route).
- **i18n**: parity test (`apps/web/src/i18n/locale-parity.test.ts`) enforces identical flattened keys across `en/zh-CN/ja`. i18next supports `{{name}}` interpolation.
- **Tooling**: commitlint conventional — subject lowercase, no ALL-CAPS words, ≤ ~70 chars; body lines ≤ 100. NEVER `--no-verify`. Merge commits fail commitlint (no `type:`) → integrate with `git merge --ff-only` (this plan's commits are linear on a feature branch).

## Commands

- shared-types build: `pnpm --filter @argus/shared-types build`
- server test file: `pnpm --filter @argus/server exec vitest run test/api/projects.routes.test.ts`
- server all / typecheck / lint: `pnpm --filter @argus/server {test,typecheck,lint}` (tests need the test Postgres; baseline green)
- web typecheck / lint / test / build: `pnpm --filter @argus/web {typecheck,lint,test,build}`
- regenerate routeTree: `pnpm --filter @argus/web exec vite build`

Commit trailer on every commit:

```
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

## File structure

| File                                           | Change     | Responsibility                                                                                      |
| ---------------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------- |
| `apps/server/src/modules/audit/types.ts`       | modify     | Add the 3 project event literals to `AuditEventType`.                                               |
| `packages/shared-types/src/api.ts`             | modify     | `createdAt` on `ProjectSummarySchema`; add `ProjectBody`/`ProjectResponse`/`DeleteProjectResponse`. |
| `apps/server/src/modules/projects/dao.ts`      | modify     | `createProject`/`renameProject`/`deleteProject` (typed result unions).                              |
| `apps/server/src/modules/projects/routes.ts`   | modify     | POST/PATCH/DELETE handlers (zod + withTenantTx + audit).                                            |
| `apps/server/test/api/projects.routes.test.ts` | modify     | Rename describe; add create/rename/delete/cascade/isolation tests.                                  |
| `apps/web/src/lib/api.ts`                      | modify     | `createProject`/`renameProject`/`deleteProject` wrappers.                                           |
| `apps/web/src/i18n/locales/{en,zh-CN,ja}.json` | modify     | `shell.settingsNav.projects` + `projects.*` page strings.                                           |
| `apps/web/src/components/layout/nav-config.ts` | modify     | Add the `projects` settings nav entry + `FolderOpen` icon.                                          |
| `apps/web/src/routes/settings/projects.tsx`    | create     | The Projects management page.                                                                       |
| `apps/web/src/routeTree.gen.ts`                | regenerate | Includes the new `/settings/projects` route (committed).                                            |

## Out of scope

Soft-delete/archive; bulk delete; project transfer; per-project settings beyond name; Members/General/Integrations pages (stay `soon`); changing the auto-create-on-ingest path.

---

## Task 1: audit — add project event types

**Files:**

- Modify: `apps/server/src/modules/audit/types.ts`

- [ ] **Step 1: Add the literals**

Replace line 1 of `apps/server/src/modules/audit/types.ts`:

```ts
export type AuditEventType =
  | 'login_success'
  | 'register'
  | 'token_create'
  | 'token_revoke'
  | 'project_create'
  | 'project_rename'
  | 'project_delete'
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @argus/server typecheck`
Expected: PASS (purely additive to a union).

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/modules/audit/types.ts
git commit -m "$(cat <<'EOF'
feat(server): add project audit event types

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: shared-types — createdAt + CRUD schemas

**Files:**

- Modify: `packages/shared-types/src/api.ts`

- [ ] **Step 1: Add `createdAt` to `ProjectSummarySchema`**

Replace the existing `ProjectSummarySchema` (currently `{ id, name }`):

```ts
export const ProjectSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
})
```

- [ ] **Step 2: Add CRUD request/response schemas**

Immediately after `ListProjectsResponseSchema`, add:

```ts
export const ProjectBodySchema = z.object({
  name: z.string().min(1).max(255),
})

export const ProjectResponseSchema = z.object({
  project: ProjectSummarySchema,
})

export const DeleteProjectResponseSchema = z.object({
  ok: z.boolean(),
})
```

- [ ] **Step 3: Export the inferred types**

At the file tail, after the existing `export type ListProjectsResponse = ...` line, add:

```ts
export type ProjectBody = z.infer<typeof ProjectBodySchema>
export type ProjectResponse = z.infer<typeof ProjectResponseSchema>
export type DeleteProjectResponse = z.infer<typeof DeleteProjectResponseSchema>
```

- [ ] **Step 4: Build**

Run: `pnpm --filter @argus/shared-types build`
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add packages/shared-types/src/api.ts
git commit -m "$(cat <<'EOF'
feat(shared-types): project createdAt + CRUD schemas

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: backend — create project (POST)

**Files:**

- Modify: `apps/server/src/modules/projects/dao.ts`, `apps/server/src/modules/projects/routes.ts`
- Test: `apps/server/test/api/projects.routes.test.ts`

- [ ] **Step 1: Prepare the test file (shared setup) + write failing create tests**

In `apps/server/test/api/projects.routes.test.ts`:

(a) Add imports for the cascade seeding used later and audit assertions. Change the import block to include `PgStorage`:

```ts
import { PgStorage } from '../../src/modules/storage/pg.js'
```

(b) Rename the describe and add a `storage` instance. Change:

```ts
describe('GET /api/projects', () => {
  let appDb: Kysely<DB>
  let admin: Kysely<DB>
  let app: FastifyInstance
  let authedOrgId: string
```

to:

```ts
describe('project routes', () => {
  let appDb: Kysely<DB>
  let admin: Kysely<DB>
  let app: FastifyInstance
  let authedOrgId: string
  const storage = new PgStorage()
```

(c) Add these tests just before the final closing `})` of the describe:

```ts
it('POST /api/projects creates a project and audits', async () => {
  authedOrgId = ORG_A
  const res = await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'alpha' } })
  expect(res.statusCode).toBe(200)
  const body = res.json() as { project: { id: string; name: string; createdAt: string } }
  expect(body.project.name).toBe('alpha')
  expect(typeof body.project.id).toBe('string')

  const audit = await admin
    .selectFrom('audit_log')
    .selectAll()
    .where('org_id', '=', ORG_A)
    .where('event_type', '=', 'project_create')
    .execute()
  expect(audit).toHaveLength(1)
  expect(audit[0]?.target_kind).toBe('project')
  expect(audit[0]?.target_id).toBe(body.project.id)
  expect(audit[0]?.metadata).toEqual({ name: 'alpha' })
})

it('POST /api/projects rejects an empty name with 400', async () => {
  authedOrgId = ORG_A
  const res = await app.inject({ method: 'POST', url: '/api/projects', payload: { name: '' } })
  expect(res.statusCode).toBe(400)
})

it('POST /api/projects returns 409 on a duplicate name', async () => {
  authedOrgId = ORG_A
  await seedProjects(ORG_A, ['dup'])
  const res = await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'dup' } })
  expect(res.statusCode).toBe(409)
})

it('POST /api/projects returns 401 without auth', async () => {
  authedOrgId = ''
  const res = await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'x' } })
  expect(res.statusCode).toBe(401)
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @argus/server exec vitest run test/api/projects.routes.test.ts`
Expected: FAIL — `POST /api/projects` is 404 (route absent), so the create/400/409 tests fail. (The 401 test may pass coincidentally since an unknown route also isn't 200; ignore — the create test failing is the signal.)

- [ ] **Step 3: Add `createProject` to the DAO**

In `apps/server/src/modules/projects/dao.ts`, after the `listProjectsForOrg` function, add:

```ts
export type CreateProjectResult = { status: 'ok'; row: ProjectRow } | { status: 'conflict' }

/** Creates a project. Returns 'conflict' if (org_id, name) already exists.
 * MUST run inside withTenantTx (projects is under FORCE RLS). */
export async function createProject(
  trx: Tx,
  orgId: string,
  name: string,
): Promise<CreateProjectResult> {
  const existing = await trx
    .selectFrom('projects')
    .where('org_id', '=', orgId)
    .where('name', '=', name)
    .select('id')
    .executeTakeFirst()
  if (existing) return { status: 'conflict' }
  const row = await trx
    .insertInto('projects')
    .values({ org_id: orgId, name })
    .returning(['id', 'name', 'created_at'])
    .executeTakeFirstOrThrow()
  return {
    status: 'ok',
    row: { id: row.id, name: row.name, createdAt: new Date(row.created_at as unknown as string) },
  }
}
```

- [ ] **Step 4: Add the POST route**

In `apps/server/src/modules/projects/routes.ts`:

(a) Replace the import block at the top:

```ts
import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { record } from '../audit/index.js'
import { createProject, listProjectsForOrg } from './dao.js'

const projectBodySchema = z.object({ name: z.string().min(1).max(255) })
```

(b) Inside the plugin, after the existing `app.get('/api/projects', ...)` handler (before the closing `}` of the plugin), add:

```ts
app.post('/api/projects', async (request, reply) => {
  if (!request.auth) {
    reply.code(401)
    return { error: 'unauthenticated' }
  }
  const parsed = projectBodySchema.safeParse(request.body)
  if (!parsed.success) {
    reply.code(400)
    return { error: 'invalid_input', issues: parsed.error.issues }
  }
  const { user } = request.auth
  const result = await request.server.withTenantTx(user.orgId, async (trx) => {
    const r = await createProject(trx, user.orgId, parsed.data.name)
    if (r.status !== 'ok') return r
    await record(trx, {
      eventType: 'project_create',
      actorUserId: user.id,
      targetKind: 'project',
      targetId: r.row.id,
      metadata: { name: r.row.name },
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    })
    return r
  })
  if (result.status === 'conflict') {
    reply.code(409)
    return { error: 'conflict' }
  }
  return {
    project: {
      id: result.row.id,
      name: result.row.name,
      createdAt: result.row.createdAt.toISOString(),
    },
  }
})
```

- [ ] **Step 5: Run — expect PASS**

Run: `pnpm --filter @argus/server exec vitest run test/api/projects.routes.test.ts`
Expected: PASS (GET tests + the 4 new create tests).

- [ ] **Step 6: Typecheck + lint**

Run: `pnpm --filter @argus/server typecheck && pnpm --filter @argus/server lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/modules/projects/dao.ts apps/server/src/modules/projects/routes.ts apps/server/test/api/projects.routes.test.ts
git commit -m "$(cat <<'EOF'
feat(server): POST /api/projects (create + audit)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: backend — rename project (PATCH)

**Files:**

- Modify: `apps/server/src/modules/projects/dao.ts`, `apps/server/src/modules/projects/routes.ts`
- Test: `apps/server/test/api/projects.routes.test.ts`

- [ ] **Step 1: Write failing rename tests**

In `apps/server/test/api/projects.routes.test.ts`, add before the describe's closing `})`:

```ts
it('PATCH /api/projects/:id renames and audits', async () => {
  authedOrgId = ORG_A
  const created = await app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: { name: 'old' },
  })
  const id = (created.json() as { project: { id: string } }).project.id

  const res = await app.inject({
    method: 'PATCH',
    url: `/api/projects/${id}`,
    payload: { name: 'new' },
  })
  expect(res.statusCode).toBe(200)
  expect((res.json() as { project: { name: string } }).project.name).toBe('new')

  const audit = await admin
    .selectFrom('audit_log')
    .selectAll()
    .where('org_id', '=', ORG_A)
    .where('event_type', '=', 'project_rename')
    .execute()
  expect(audit).toHaveLength(1)
  expect(audit[0]?.target_id).toBe(id)
  expect(audit[0]?.metadata).toEqual({ name: 'new' })
})

it('PATCH /api/projects/:id returns 409 when renaming to an existing name', async () => {
  authedOrgId = ORG_A
  await seedProjects(ORG_A, ['taken'])
  const created = await app.inject({
    method: 'POST',
    url: '/api/projects',
    payload: { name: 'mine' },
  })
  const id = (created.json() as { project: { id: string } }).project.id
  const res = await app.inject({
    method: 'PATCH',
    url: `/api/projects/${id}`,
    payload: { name: 'taken' },
  })
  expect(res.statusCode).toBe(409)
})

it('PATCH /api/projects/:id returns 404 for an unknown id', async () => {
  authedOrgId = ORG_A
  const res = await app.inject({
    method: 'PATCH',
    url: '/api/projects/00000000-0000-0000-0000-0000000000ff',
    payload: { name: 'whatever' },
  })
  expect(res.statusCode).toBe(404)
})
```

- [ ] **Step 2: Run — expect FAIL** (`PATCH` route absent → 404 for the rename/409 tests where 200/409 expected).

Run: `pnpm --filter @argus/server exec vitest run test/api/projects.routes.test.ts`

- [ ] **Step 3: Add `renameProject` to the DAO**

In `apps/server/src/modules/projects/dao.ts`, after `createProject`, add:

```ts
export type RenameProjectResult =
  | { status: 'ok'; row: ProjectRow }
  | { status: 'conflict' }
  | { status: 'not_found' }

/** Renames a project owned by orgId. 'not_found' if it doesn't exist for the
 * org; 'conflict' if another project in the org already has the new name. */
export async function renameProject(
  trx: Tx,
  orgId: string,
  id: string,
  name: string,
): Promise<RenameProjectResult> {
  const current = await trx
    .selectFrom('projects')
    .where('org_id', '=', orgId)
    .where('id', '=', id)
    .select('id')
    .executeTakeFirst()
  if (!current) return { status: 'not_found' }
  const dup = await trx
    .selectFrom('projects')
    .where('org_id', '=', orgId)
    .where('name', '=', name)
    .where('id', '!=', id)
    .select('id')
    .executeTakeFirst()
  if (dup) return { status: 'conflict' }
  const row = await trx
    .updateTable('projects')
    .set({ name })
    .where('id', '=', id)
    .where('org_id', '=', orgId)
    .returning(['id', 'name', 'created_at'])
    .executeTakeFirstOrThrow()
  return {
    status: 'ok',
    row: { id: row.id, name: row.name, createdAt: new Date(row.created_at as unknown as string) },
  }
}
```

- [ ] **Step 4: Add the PATCH route**

In `apps/server/src/modules/projects/routes.ts`:

(a) Add `renameProject` to the dao import:

```ts
import { createProject, listProjectsForOrg, renameProject } from './dao.js'
```

(b) After the POST handler, add:

```ts
app.patch<{ Params: { id: string } }>('/api/projects/:id', async (request, reply) => {
  if (!request.auth) {
    reply.code(401)
    return { error: 'unauthenticated' }
  }
  const parsed = projectBodySchema.safeParse(request.body)
  if (!parsed.success) {
    reply.code(400)
    return { error: 'invalid_input', issues: parsed.error.issues }
  }
  const { user } = request.auth
  const result = await request.server.withTenantTx(user.orgId, async (trx) => {
    const r = await renameProject(trx, user.orgId, request.params.id, parsed.data.name)
    if (r.status !== 'ok') return r
    await record(trx, {
      eventType: 'project_rename',
      actorUserId: user.id,
      targetKind: 'project',
      targetId: r.row.id,
      metadata: { name: r.row.name },
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    })
    return r
  })
  if (result.status === 'not_found') {
    reply.code(404)
    return { error: 'not_found' }
  }
  if (result.status === 'conflict') {
    reply.code(409)
    return { error: 'conflict' }
  }
  return {
    project: {
      id: result.row.id,
      name: result.row.name,
      createdAt: result.row.createdAt.toISOString(),
    },
  }
})
```

- [ ] **Step 5: Run — expect PASS**

Run: `pnpm --filter @argus/server exec vitest run test/api/projects.routes.test.ts`

- [ ] **Step 6: Typecheck + lint**

Run: `pnpm --filter @argus/server typecheck && pnpm --filter @argus/server lint`

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/modules/projects/dao.ts apps/server/src/modules/projects/routes.ts apps/server/test/api/projects.routes.test.ts
git commit -m "$(cat <<'EOF'
feat(server): PATCH /api/projects/:id (rename + audit)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: backend — delete project (DELETE, destructive)

**Files:**

- Modify: `apps/server/src/modules/projects/dao.ts`, `apps/server/src/modules/projects/routes.ts`
- Test: `apps/server/test/api/projects.routes.test.ts`

- [ ] **Step 1: Write failing delete tests (incl. cascade + isolation)**

In `apps/server/test/api/projects.routes.test.ts`, add before the describe's closing `})`:

```ts
it('DELETE /api/projects/:id deletes, audits, and cascades children', async () => {
  authedOrgId = ORG_A
  await app.withTenantTx(ORG_A, (trx) =>
    storage.writeTrace(trx, {
      orgId: ORG_A,
      projectName: 'doomed',
      serviceName: 'svc',
      traceId: '4'.repeat(32),
      sessionStartedAt: new Date('2026-05-28T12:00:00Z'),
      sessionEndedAt: new Date('2026-05-28T12:00:01Z'),
      steps: [
        {
          spanId: 'a'.repeat(16),
          parentSpanId: null,
          name: 'x',
          kind: null,
          componentType: null,
          componentName: null,
          startedAt: new Date('2026-05-28T12:00:00Z'),
          endedAt: new Date('2026-05-28T12:00:01Z'),
          attributes: {},
          statusCode: 'OK',
          statusMessage: null,
          events: [
            {
              name: 'argus.input',
              ts: new Date('2026-05-28T12:00:00.5Z'),
              attributes: { text: 'hi' },
            },
          ],
        },
      ],
    }),
  )
  const proj = await admin
    .selectFrom('projects')
    .select(['id'])
    .where('name', '=', 'doomed')
    .executeTakeFirstOrThrow()
  await admin
    .insertInto('ingest_tokens')
    .values({
      project_id: proj.id,
      name: 'tok',
      token_prefix: 'argus_abcd12',
      token_hash: 'h'.repeat(64),
    })
    .execute()

  const res = await app.inject({ method: 'DELETE', url: `/api/projects/${proj.id}` })
  expect(res.statusCode).toBe(200)
  expect(res.json()).toEqual({ ok: true })

  expect(await admin.selectFrom('projects').selectAll().execute()).toHaveLength(0)
  expect(await admin.selectFrom('services').selectAll().execute()).toHaveLength(0)
  expect(await admin.selectFrom('sessions').selectAll().execute()).toHaveLength(0)
  expect(await admin.selectFrom('steps').selectAll().execute()).toHaveLength(0)
  expect(await admin.selectFrom('step_events').selectAll().execute()).toHaveLength(0)
  expect(await admin.selectFrom('ingest_tokens').selectAll().execute()).toHaveLength(0)

  const audit = await admin
    .selectFrom('audit_log')
    .selectAll()
    .where('org_id', '=', ORG_A)
    .where('event_type', '=', 'project_delete')
    .execute()
  expect(audit).toHaveLength(1)
  expect(audit[0]?.target_id).toBe(proj.id)
  expect(audit[0]?.metadata).toEqual({ name: 'doomed' })
})

it('DELETE /api/projects/:id returns 404 for an unknown id', async () => {
  authedOrgId = ORG_A
  const res = await app.inject({
    method: 'DELETE',
    url: '/api/projects/00000000-0000-0000-0000-0000000000ff',
  })
  expect(res.statusCode).toBe(404)
})

it('DELETE /api/projects/:id cannot delete another org project (404)', async () => {
  authedOrgId = ORG_B
  await seedProjects(ORG_A, ['org-a-only'])
  const proj = await admin
    .selectFrom('projects')
    .select(['id'])
    .where('name', '=', 'org-a-only')
    .executeTakeFirstOrThrow()
  const res = await app.inject({ method: 'DELETE', url: `/api/projects/${proj.id}` })
  expect(res.statusCode).toBe(404)
  expect(await admin.selectFrom('projects').selectAll().execute()).toHaveLength(1)
})
```

- [ ] **Step 2: Run — expect FAIL** (DELETE route absent).

Run: `pnpm --filter @argus/server exec vitest run test/api/projects.routes.test.ts`

- [ ] **Step 3: Add `deleteProject` to the DAO**

In `apps/server/src/modules/projects/dao.ts`, after `renameProject`, add:

```ts
export type DeleteProjectResult = { status: 'ok'; name: string } | { status: 'not_found' }

/** Deletes a project owned by orgId. The DB cascade removes services, sessions,
 * steps, step_events, and ingest_tokens. Returns the deleted name (for audit)
 * or 'not_found'. */
export async function deleteProject(
  trx: Tx,
  orgId: string,
  id: string,
): Promise<DeleteProjectResult> {
  const current = await trx
    .selectFrom('projects')
    .where('org_id', '=', orgId)
    .where('id', '=', id)
    .select('name')
    .executeTakeFirst()
  if (!current) return { status: 'not_found' }
  await trx.deleteFrom('projects').where('id', '=', id).where('org_id', '=', orgId).execute()
  return { status: 'ok', name: current.name }
}
```

- [ ] **Step 4: Add the DELETE route**

In `apps/server/src/modules/projects/routes.ts`:

(a) Add `deleteProject` to the dao import:

```ts
import { createProject, deleteProject, listProjectsForOrg, renameProject } from './dao.js'
```

(b) After the PATCH handler, add:

```ts
app.delete<{ Params: { id: string } }>('/api/projects/:id', async (request, reply) => {
  if (!request.auth) {
    reply.code(401)
    return { error: 'unauthenticated' }
  }
  const { user } = request.auth
  const result = await request.server.withTenantTx(user.orgId, async (trx) => {
    const r = await deleteProject(trx, user.orgId, request.params.id)
    if (r.status !== 'ok') return r
    await record(trx, {
      eventType: 'project_delete',
      actorUserId: user.id,
      targetKind: 'project',
      targetId: request.params.id,
      metadata: { name: r.name },
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    })
    return r
  })
  if (result.status === 'not_found') {
    reply.code(404)
    return { error: 'not_found' }
  }
  return { ok: true }
})
```

- [ ] **Step 5: Run — expect PASS** (incl. the cascade test asserting all children gone).

Run: `pnpm --filter @argus/server exec vitest run test/api/projects.routes.test.ts`

- [ ] **Step 6: Full server suite + typecheck + lint**

Run: `pnpm --filter @argus/server test && pnpm --filter @argus/server typecheck && pnpm --filter @argus/server lint`
Expected: all PASS (no regression elsewhere).

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/modules/projects/dao.ts apps/server/src/modules/projects/routes.ts apps/server/test/api/projects.routes.test.ts
git commit -m "$(cat <<'EOF'
feat(server): DELETE /api/projects/:id (cascade delete + audit)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: frontend — api wrappers

**Files:**

- Modify: `apps/web/src/lib/api.ts`

- [ ] **Step 1: Extend the shared-types import**

In `apps/web/src/lib/api.ts`, change the `@argus/shared-types` import block to add the new schemas + types:

```ts
import {
  GetSessionResponseSchema,
  ListSessionsResponseSchema,
  ListProjectsResponseSchema,
  ProjectResponseSchema,
  type GetSessionResponse,
  type ListSessionsResponse,
  type ListProjectsResponse,
  type ProjectResponse,
} from '@argus/shared-types'
```

- [ ] **Step 2: Add the wrappers**

Right after the existing `fetchProjects` function, add:

```ts
export async function createProject(input: { name: string }): Promise<ProjectResponse> {
  return ProjectResponseSchema.parse(
    await fetchJson('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  )
}

export async function renameProject(id: string, input: { name: string }): Promise<ProjectResponse> {
  return ProjectResponseSchema.parse(
    await fetchJson(`/api/projects/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  )
}

export async function deleteProject(id: string): Promise<void> {
  await fetchJson(`/api/projects/${id}`, { method: 'DELETE' })
}
```

(`fetchJson` throws `Error('HTTP 409 on …')` on a duplicate name; the page detects `409` in the message.)

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @argus/web typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/api.ts
git commit -m "$(cat <<'EOF'
feat(web): createProject / renameProject / deleteProject api wrappers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: frontend — i18n strings (en / zh-CN / ja)

**Files:**

- Modify: `apps/web/src/i18n/locales/en.json`, `zh-CN.json`, `ja.json`

The parity test requires identical keys across all three. Add `shell.settingsNav.projects` (into the existing `shell.settingsNav` object) and a new top-level `projects` object, in all three files.

- [ ] **Step 1: en.json**

Add `"projects": "Projects"` to the `shell.settingsNav` object. Add a top-level `projects` object (sibling of `shell`):

```json
"projects": {
  "title": "Projects",
  "intro": "Create, rename, and delete projects. Deleting a project permanently removes all of its sessions and tokens.",
  "create": {
    "title": "Create project",
    "name": "Project name",
    "placeholder": "my-project",
    "submit": "Create",
    "submitting": "Creating…",
    "conflict": "A project with that name already exists."
  },
  "existing": {
    "title": "Your projects",
    "empty": "No projects yet.",
    "columns": { "name": "Name", "created": "Created", "actions": "Actions" }
  },
  "rename": {
    "action": "Rename",
    "save": "Save",
    "cancel": "Cancel",
    "conflict": "A project with that name already exists."
  },
  "delete": {
    "action": "Delete",
    "title": "Delete project",
    "warning": "This permanently deletes {{name}} and all of its services, sessions, steps, and tokens. This cannot be undone.",
    "confirmLabel": "Type {{name}} to confirm",
    "submit": "Delete project",
    "submitting": "Deleting…",
    "cancel": "Cancel"
  }
}
```

- [ ] **Step 2: zh-CN.json** (same keys, translated)

`shell.settingsNav.projects`: `"项目"`. Top-level `projects`:

```json
"projects": {
  "title": "项目",
  "intro": "创建、重命名和删除项目。删除项目会永久移除其全部会话和令牌。",
  "create": {
    "title": "创建项目",
    "name": "项目名称",
    "placeholder": "my-project",
    "submit": "创建",
    "submitting": "创建中…",
    "conflict": "已存在同名项目。"
  },
  "existing": {
    "title": "你的项目",
    "empty": "暂无项目。",
    "columns": { "name": "名称", "created": "创建时间", "actions": "操作" }
  },
  "rename": {
    "action": "重命名",
    "save": "保存",
    "cancel": "取消",
    "conflict": "已存在同名项目。"
  },
  "delete": {
    "action": "删除",
    "title": "删除项目",
    "warning": "这将永久删除 {{name}} 及其全部服务、会话、步骤和令牌。此操作无法撤销。",
    "confirmLabel": "输入 {{name}} 以确认",
    "submit": "删除项目",
    "submitting": "删除中…",
    "cancel": "取消"
  }
}
```

- [ ] **Step 3: ja.json** (same keys, translated)

`shell.settingsNav.projects`: `"プロジェクト"`. Top-level `projects`:

```json
"projects": {
  "title": "プロジェクト",
  "intro": "プロジェクトの作成・名前変更・削除ができます。削除するとそのセッションとトークンがすべて完全に削除されます。",
  "create": {
    "title": "プロジェクトを作成",
    "name": "プロジェクト名",
    "placeholder": "my-project",
    "submit": "作成",
    "submitting": "作成中…",
    "conflict": "同じ名前のプロジェクトが既に存在します。"
  },
  "existing": {
    "title": "あなたのプロジェクト",
    "empty": "プロジェクトはまだありません。",
    "columns": { "name": "名前", "created": "作成日時", "actions": "操作" }
  },
  "rename": {
    "action": "名前を変更",
    "save": "保存",
    "cancel": "キャンセル",
    "conflict": "同じ名前のプロジェクトが既に存在します。"
  },
  "delete": {
    "action": "削除",
    "title": "プロジェクトを削除",
    "warning": "{{name}} とそのすべてのサービス・セッション・ステップ・トークンを完全に削除します。この操作は取り消せません。",
    "confirmLabel": "{{name}} と入力して確認",
    "submit": "プロジェクトを削除",
    "submitting": "削除中…",
    "cancel": "キャンセル"
  }
}
```

- [ ] **Step 4: Parity check**

Run: `pnpm --filter @argus/web exec vitest run src/i18n/locale-parity.test.ts`
Expected: PASS. If it fails, the diff names the missing/extra key — fix and re-run.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/i18n/locales/en.json apps/web/src/i18n/locales/zh-CN.json apps/web/src/i18n/locales/ja.json
git commit -m "$(cat <<'EOF'
feat(web): i18n strings for the projects settings page

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: frontend — Projects settings page + nav entry (+ routeTree)

**Files:**

- Create: `apps/web/src/routes/settings/projects.tsx`
- Modify: `apps/web/src/components/layout/nav-config.ts`
- Regenerate + commit: `apps/web/src/routeTree.gen.ts`

- [ ] **Step 1: Create the page**

Create `apps/web/src/routes/settings/projects.tsx` with EXACTLY:

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createProject, deleteProject, fetchProjects, renameProject } from '../../lib/api'
import { useLocaleFormat } from '../../lib/use-locale-format'
import { useProjectFilter } from '../../lib/use-project-filter'

export const Route = createFileRoute('/settings/projects')({
  component: ProjectsPage,
})

const inputClass =
  'h-8 w-full rounded border border-hairline px-3 u-body text-text-1 bg-page focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-1'

function isConflict(err: unknown): boolean {
  return err instanceof Error && err.message.includes('409')
}

function ProjectsPage() {
  const { t } = useTranslation()
  const f = useLocaleFormat()
  const queryClient = useQueryClient()
  const { project: activeProject, setProject } = useProjectFilter()
  const { data, isLoading, error } = useQuery({
    queryKey: ['projects'],
    queryFn: fetchProjects,
    retry: false,
  })

  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmText, setConfirmText] = useState('')

  const create = useMutation({
    mutationFn: () => createProject({ name: newName }),
    onSuccess: () => {
      setNewName('')
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })

  const rename = useMutation({
    mutationFn: (vars: { id: string; name: string }) => renameProject(vars.id, { name: vars.name }),
    onSuccess: () => {
      setEditingId(null)
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })

  const remove = useMutation({
    mutationFn: (id: string) => deleteProject(id),
    onSuccess: (_data, id) => {
      setDeletingId(null)
      setConfirmText('')
      void queryClient.invalidateQueries({ queryKey: ['projects'] })
      void queryClient.invalidateQueries({ queryKey: ['sessions'] })
      if (activeProject === id) setProject(null)
    },
  })

  if (isLoading) return <p className="p-6 u-body text-text-3">{t('common.loading')}</p>
  if (error)
    return <p className="p-6 u-body text-danger">{t('common.error', { message: String(error) })}</p>

  const projects = data?.projects ?? []
  const deleting = deletingId ? (projects.find((p) => p.id === deletingId) ?? null) : null

  return (
    <div className="p-6 space-y-6 overflow-auto h-full">
      <header>
        <h2 className="u-h-lg text-text-1">{t('projects.title')}</h2>
        <p className="u-body text-text-3 mt-1">{t('projects.intro')}</p>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (newName) create.mutate()
        }}
        className="border border-hairline rounded p-3 space-y-3 max-w-xl"
      >
        <h3 className="u-h-md text-text-1">{t('projects.create.title')}</h3>
        <label className="block space-y-1">
          <span className="u-caption text-text-3">{t('projects.create.name')}</span>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t('projects.create.placeholder')}
            required
            className={inputClass}
          />
        </label>
        <button
          type="submit"
          disabled={create.isPending}
          className="h-8 px-4 rounded bg-brand text-white u-body hover:bg-brand-hover transition-colors disabled:opacity-50"
        >
          {create.isPending ? t('projects.create.submitting') : t('projects.create.submit')}
        </button>
        {create.error && (
          <p className="u-caption text-danger">
            {isConflict(create.error) ? t('projects.create.conflict') : String(create.error)}
          </p>
        )}
      </form>

      <section>
        <h3 className="u-h-md text-text-1 mb-2">{t('projects.existing.title')}</h3>
        {projects.length === 0 && (
          <p className="u-body text-text-3">{t('projects.existing.empty')}</p>
        )}
        {projects.length > 0 && (
          <div className="border border-hairline rounded">
            <table className="w-full u-body">
              <thead>
                <tr className="text-left u-caption text-text-3 border-b border-hairline">
                  <th className="font-normal px-3 py-2">{t('projects.existing.columns.name')}</th>
                  <th className="font-normal px-3 py-2">
                    {t('projects.existing.columns.created')}
                  </th>
                  <th className="px-3 py-2 text-right">{t('projects.existing.columns.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id} className="border-b border-hairline last:border-0">
                    <td className="px-3 py-2 text-text-1">
                      {editingId === p.id ? (
                        <input
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          className={inputClass}
                          autoFocus
                        />
                      ) : (
                        p.name
                      )}
                    </td>
                    <td className="px-3 py-2 text-text-3 tabular">
                      {f.dateTime(new Date(p.createdAt))}
                    </td>
                    <td className="px-3 py-2 text-right space-x-3">
                      {editingId === p.id ? (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              editingName && rename.mutate({ id: p.id, name: editingName })
                            }
                            disabled={rename.isPending}
                            className="u-caption text-brand hover:underline disabled:opacity-50"
                          >
                            {t('projects.rename.save')}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="u-caption text-text-3 hover:underline"
                          >
                            {t('projects.rename.cancel')}
                          </button>
                          {rename.error && editingId === p.id && (
                            <span className="u-caption text-danger">
                              {isConflict(rename.error)
                                ? t('projects.rename.conflict')
                                : String(rename.error)}
                            </span>
                          )}
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(p.id)
                              setEditingName(p.name)
                              rename.reset()
                            }}
                            className="u-caption text-text-3 hover:text-text-1 hover:underline"
                          >
                            {t('projects.rename.action')}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setDeletingId(p.id)
                              setConfirmText('')
                            }}
                            className="u-caption text-danger hover:underline"
                          >
                            {t('projects.delete.action')}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {deleting && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 pt-32"
          onClick={() => setDeletingId(null)}
        >
          <div
            className="w-[32rem] max-w-[90vw] rounded-md border border-hairline bg-popover p-4 space-y-3 shadow-[var(--shadow-dialog)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="u-h-md text-danger">{t('projects.delete.title')}</h3>
            <p className="u-body text-text-2">
              {t('projects.delete.warning', { name: deleting.name })}
            </p>
            <label className="block space-y-1">
              <span className="u-caption text-text-3">
                {t('projects.delete.confirmLabel', { name: deleting.name })}
              </span>
              <input
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                className={inputClass}
                autoFocus
              />
            </label>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeletingId(null)}
                className="h-8 px-4 rounded border border-hairline text-text-2 u-body hover:bg-tile"
              >
                {t('projects.delete.cancel')}
              </button>
              <button
                type="button"
                disabled={confirmText !== deleting.name || remove.isPending}
                onClick={() => remove.mutate(deleting.id)}
                className="h-8 px-4 rounded bg-danger text-white u-body hover:opacity-90 disabled:opacity-50"
              >
                {remove.isPending ? t('projects.delete.submitting') : t('projects.delete.submit')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Add the nav entry**

In `apps/web/src/components/layout/nav-config.ts`:

(a) Add `FolderOpen` to the `lucide-react` import (keep the list alphabetical-ish; just add it):

```ts
import {
  Activity,
  BarChart3,
  FlaskConical,
  FolderOpen,
  KeyRound,
  ListTree,
  Plug,
  Settings,
  Users,
} from 'lucide-react'
```

(b) Insert a `projects` entry into `SETTINGS_NAV` between `tokens` and `members`:

```ts
export const SETTINGS_NAV: NavEntry[] = [
  { key: 'tokens', labelKey: 'shell.settingsNav.tokens', icon: KeyRound, to: '/settings/tokens' },
  {
    key: 'projects',
    labelKey: 'shell.settingsNav.projects',
    icon: FolderOpen,
    to: '/settings/projects',
  },
  { key: 'members', labelKey: 'shell.settingsNav.members', icon: Users, soon: true },
  { key: 'general', labelKey: 'shell.settingsNav.general', icon: Settings, soon: true },
  { key: 'integrations', labelKey: 'shell.settingsNav.integrations', icon: Plug, soon: true },
]
```

- [ ] **Step 3: Regenerate the route tree**

Run: `pnpm --filter @argus/web exec vite build`
Expected: completes and rewrites `apps/web/src/routeTree.gen.ts` to include `/settings/projects`. (vite/esbuild does not typecheck, so it succeeds; this step exists only to regenerate the tree.)

Confirm: `grep -c "settings/projects" apps/web/src/routeTree.gen.ts` → ≥ 1.

- [ ] **Step 4: Gates**

Run: `pnpm --filter @argus/web typecheck && pnpm --filter @argus/web lint && pnpm --filter @argus/web test && pnpm --filter @argus/web build`
Expected: all PASS. (`createFileRoute('/settings/projects')` and the nav `to` now resolve against the regenerated tree.)

- [ ] **Step 5: Commit (including routeTree.gen.ts — a real route change)**

```bash
git add apps/web/src/routes/settings/projects.tsx apps/web/src/components/layout/nav-config.ts apps/web/src/routeTree.gen.ts
git commit -m "$(cat <<'EOF'
feat(web): projects settings page (create / rename / delete)

Adds /settings/projects with a create form and a list supporting inline
rename and type-the-name delete confirmation. Deleting the active project
resets the project filter. Adds the Projects entry to the settings nav and
regenerates the route tree.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: Visual verification (dev server)**

With the app running and logged in: Settings shows a **Projects** entry → the page lists projects with Created dates. Create a project → it appears; creating a duplicate name shows the "already exists" message. Rename inline → the name updates (and the sidebar switcher label updates); renaming to an existing name shows the conflict message. Delete → the confirmation dialog requires typing the exact name to enable the destructive button; deleting the currently-selected project resets the switcher to "All projects" and the sessions list shows all.

---

## Final verification

- [ ] `pnpm --filter @argus/shared-types build` → success.
- [ ] `pnpm --filter @argus/server test && pnpm --filter @argus/server typecheck && pnpm --filter @argus/server lint` → all pass (incl. create/rename/delete/cascade/isolation + audit). Needs test Postgres.
- [ ] `pnpm --filter @argus/web typecheck && pnpm --filter @argus/web lint && pnpm --filter @argus/web test && pnpm --filter @argus/web build` → all pass.
- [ ] `grep -c "settings/projects" apps/web/src/routeTree.gen.ts` → ≥ 1 (route committed).
- [ ] Manual smoke: create / rename / delete from Settings → Projects; duplicate → inline conflict; delete requires typed name; deleting the active project resets the filter.

---

## Self-review (completed by plan author)

- **Spec coverage:** POST create + 409 (T3) ✓; PATCH rename + 409/404 (T4) ✓; DELETE cascade + 404 + isolation + audit (T5) ✓; audit event types (T1) ✓; shared-types create/rename/delete schemas (T2) ✓; api wrappers (T6) ✓; new Settings → Projects nav entry (T8) ✓; page with create form + list + inline rename + type-name delete confirm (T8) ✓; delete resets active filter + invalidates `['projects']`/`['sessions']` (T8) ✓; i18n in all three locales with parity (T7) ✓; backend cascade/audit/isolation tests (T3–T5) ✓.
- **Spec corrections (verified against real code, the spec's "facts" were wrong):** `AuditEventType` did NOT already have the project literals — T1 adds them. `ProjectSummarySchema` had no `createdAt` — T2 adds it (the page's Created column needs it; the GET route already emits it). Both corrections are noted in Source of truth.
- **Type consistency:** DAO result unions (`CreateProjectResult`/`RenameProjectResult`/`DeleteProjectResult`) use a `status` discriminant consumed identically in the routes; `ProjectRow { id, name, createdAt: Date }` → route maps `createdAt.toISOString()` → matches `ProjectSummarySchema` (now with `createdAt`); `ProjectResponse = { project: ProjectSummary }` consumed by `createProject`/`renameProject` wrappers and the page; audit `metadata: { name }` matches the test assertions; `record` import path `../audit/index.js`.
- **routeTree:** unlike every prior feature, this one ADDS a route, so `routeTree.gen.ts` is regenerated (T8 step 3 via `vite build`) and committed (T8 step 5). The plan does not `git checkout` it away.
- **Placeholder scan:** none — every step has complete code/commands.
- **Commit granularity:** 8 linear commits, each green on its own (audit type → shared-types → 3 backend → api → i18n → page). Backend tasks each leave the suite green; frontend tasks compile independently (api wrappers and i18n are standalone; the page+nav+routeTree land together because `createFileRoute` needs the regenerated tree).
