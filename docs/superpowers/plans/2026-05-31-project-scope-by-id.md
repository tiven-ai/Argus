# Project Scope by ID (rename-safe) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the active-project selection key on the project **id** (URL `?projectId=`, localStorage `argus.projectId`, `useProjectFilter`), with all session filtering done server-side, so a future project rename won't orphan the selection.

**Architecture:** `useProjectFilter` switches its stored value from project name to project id and renames the URL param + localStorage key. The three consumers (sessions list, session rail, session detail) drop client-side name filtering and pass the id straight to `fetchSessions(projectId)`. The switcher selects by id but displays the name. The now-unused `filterSessionsByProject` is deleted. The backend `GET /api/sessions` gains a guard so a non-uuid `projectId` returns all sessions instead of 500ing.

**Tech Stack:** React 19 + TanStack Router/Query, Zod, Vitest. Backend Fastify + Kysely + Postgres.

---

## Source of truth (verified against the code on 2026-05-31)

- **`apps/web/src/lib/use-project-filter.ts`** (full): `PROJECT_KEY = 'argus.project'`; `readStored()` reads that key; `useSearch({ strict: false }) as { project?: string }`; `project = search.project ?? readStored() ?? null`; `setProject(next)` writes/removes localStorage then `navigate({ to: '/sessions', search: next ? { project: next } : {} })`; returns `{ project, setProject }`.
- **`apps/web/src/routes/sessions/index.tsx`**: imports `{ fetchProjects, fetchSessions }`, `{ filterSessionsByProject, listDurationLabel }`. `validateSearch` returns `{ project?: string }`. Inside: `const { project } = useProjectFilter()`; a `['projects']` query; `projectId = project && projectsData ? projectsData.projects.find(p => p.name === project)?.id : undefined`; `['sessions', projectId ?? null]` query calling `fetchSessions(projectId)`; `rows = data ? filterSessionsByProject(data.sessions, project) : []`. The table hides the Project column/cell when `!project` is false (i.e. when `project` is truthy). `listDurationLabel` used in the rows.
- **`apps/web/src/routes/sessions/$sessionId.tsx`**: imports `{ adjacentSessions, filterSessionsByProject }`. `const { project } = useProjectFilter()`; a `['sessions']` query `queryFn: () => fetchSessions()`; `siblings = list ? filterSessionsByProject(list.sessions, project) : []`; `adjacentSessions(siblings, sessionId)`. Search schema is `z.object({ round: z.string().optional() })`.
- **`apps/web/src/features/session-replay/rail/SessionRail.tsx`**: imports `{ fetchSessions }`, `{ filterSessionsByProject }`. `const { project } = useProjectFilter()`; `['sessions']` query `queryFn: () => fetchSessions()`; `rows = data ? filterSessionsByProject(data.sessions, project) : []`.
- **`apps/web/src/components/layout/ProjectSwitcher.tsx`**: `const { project, setProject } = useProjectFilter()`; `['projects']` query; `projects = data ? data.projects.map(p => p.name) : []`; `current = project ?? t('shell.project.all')`; "All projects" item `onSelect={() => setProject(null)}` with check when `project === null`; each item `key={p}` `onSelect={() => setProject(p)}` showing `p` with check when `project === p`.
- **`apps/web/src/lib/sessions-select.ts`**: exports `filterSessionsByProject(sessions, project)` (filters by `s.projectName === project`), `adjacentSessions`, `listDurationLabel`. `import type { SessionSummary }` used by all three.
- **`apps/web/src/lib/sessions-select.test.ts`**: has `describe('filterSessionsByProject', ...)` (uses the `s()` factory) plus `adjacentSessions` and `listDurationLabel` describes; import line is `import { filterSessionsByProject, adjacentSessions, listDurationLabel } from './sessions-select'`.
- **`apps/web/src/lib/api.ts`**: `fetchSessions(projectId?: string)` appends `?projectId=<encoded>` when given; `fetchProjects()` returns `ListProjectsResponse` = `{ projects: { id, name, createdAt }[] }`.
- **Backend `apps/server/src/modules/api/routes.ts`** `GET /api/sessions` handler: `const query = request.query as { limit?: string; projectId?: string }`; `limit` computed; `deps.storage.listSessions(trx, { orgId, projectId: query.projectId, limit })`. `zod` is **not** currently imported in this file (tokens routes import it, this one does not — confirm and add the import).
- **Backend test `apps/server/test/api/routes.test.ts`** (`describe('Query API routes', ...)`): app on `createAppRoleTestDb()`, super-user `admin` via `createTestDb()`, `truncateAll(admin)` in `beforeEach`, `ORG = '00000000-0000-0000-0000-000000000000'`, `storage = new PgStorage()`. Last test `'GET /api/sessions filters by projectId'` seeds two projects, resolves the id via `trx.selectFrom('projects').select(['id','name'])`, asserts the filter. `ListSessionsResponseSchema` imported.
- **Tooling:** commitlint is active (conventional, `subject-case` + header/body length). Keep commit subjects lowercase, ≤ ~70 chars, no ALL-CAPS words; wrap body lines ≤ 100 chars. NEVER `--no-verify`. The dev server rewrites `apps/web/src/routeTree.gen.ts` (noise) — `git checkout -- apps/web/src/routeTree.gen.ts` before staging; this feature does NOT change routes so it must never be committed.

## Commands

- web typecheck / lint / test / build: `pnpm --filter @argus/web {typecheck,lint,test,build}`
- one server test file: `pnpm --filter @argus/server exec vitest run test/api/routes.test.ts`
- all server tests: `pnpm --filter @argus/server test` (needs the test Postgres; baseline is green)

Commit trailer on every commit:

```
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

## File structure

| File                                                        | Change | Responsibility                                                                                        |
| ----------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------- |
| `apps/web/src/lib/use-project-filter.ts`                    | modify | Store/read project **id**; rename param `project`→`projectId`, key `argus.project`→`argus.projectId`. |
| `apps/web/src/components/layout/ProjectSwitcher.tsx`        | modify | Select by `p.id`, display `p.name`; resolve active id→name for the label.                             |
| `apps/web/src/routes/sessions/index.tsx`                    | modify | `project` is an id; drop name→id lookup + client filter; `validateSearch` → `{ projectId? }`.         |
| `apps/web/src/routes/sessions/$sessionId.tsx`               | modify | Filter siblings server-side via `fetchSessions(project ?? undefined)`.                                |
| `apps/web/src/features/session-replay/rail/SessionRail.tsx` | modify | Same server-side fetch by id.                                                                         |
| `apps/web/src/lib/sessions-select.ts`                       | modify | Delete now-unused `filterSessionsByProject`.                                                          |
| `apps/web/src/lib/sessions-select.test.ts`                  | modify | Delete the `filterSessionsByProject` describe + drop it from the import.                              |
| `apps/server/src/modules/api/routes.ts`                     | modify | Guard `?projectId`: ignore a non-uuid value (return all, no 500).                                     |
| `apps/server/test/api/routes.test.ts`                       | modify | Add a test: `?projectId=not-a-uuid` → 200 with all sessions.                                          |

## Out of scope

`/p/$projectId` path scope, breadcrumb with project name, "All projects" landing page; project create/rename/delete + Settings page (→ ③). No change to `SessionSummary`/`ProjectSummary` shapes.

---

## Task 1: Backend — tolerate a non-uuid `projectId` (no 500)

**Files:**

- Modify: `apps/server/src/modules/api/routes.ts`
- Test: `apps/server/test/api/routes.test.ts`

- [ ] **Step 1: Add the failing test**

In `apps/server/test/api/routes.test.ts`, add this test inside the `describe('Query API routes', ...)` block, immediately after the existing `'GET /api/sessions filters by projectId'` test (before the describe's closing `})`):

```ts
it('GET /api/sessions ignores a non-uuid projectId and returns all', async () => {
  await app.withTenantTx(ORG, (trx) =>
    storage.writeTrace(trx, {
      orgId: ORG,
      projectName: 'proj-one',
      serviceName: 's1',
      traceId: '3'.repeat(32),
      sessionStartedAt: new Date('2026-05-28T12:00:00Z'),
      sessionEndedAt: new Date('2026-05-28T12:00:01Z'),
      steps: [],
    }),
  )
  const res = await app.inject({ method: 'GET', url: '/api/sessions?projectId=not-a-uuid' })
  expect(res.statusCode).toBe(200)
  expect(ListSessionsResponseSchema.parse(res.json()).sessions).toHaveLength(1)
})
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `pnpm --filter @argus/server exec vitest run test/api/routes.test.ts`
Expected: FAIL — the non-uuid value reaches Postgres, which errors on `uuid` cast; the route returns 500, so `statusCode` is not 200.

- [ ] **Step 3: Add the uuid guard in the route**

In `apps/server/src/modules/api/routes.ts`:

(a) Add the zod import at the top of the file (the file does not currently import it):

```ts
import { z } from 'zod'
```

(b) In the `GET /api/sessions` handler, replace the projectId pass-through. Current code:

```ts
const query = request.query as { limit?: string; projectId?: string }
const limit = query.limit ? Math.min(200, Math.max(1, parseInt(query.limit, 10))) : 50
const orgId = request.auth.user.orgId
const sessions = await request.server.withTenantTx(orgId, (trx) =>
  deps.storage.listSessions(trx, { orgId, projectId: query.projectId, limit }),
)
```

becomes:

```ts
const query = request.query as { limit?: string; projectId?: string }
const limit = query.limit ? Math.min(200, Math.max(1, parseInt(query.limit, 10))) : 50
const projectId = z.string().uuid().safeParse(query.projectId).success ? query.projectId : undefined
const orgId = request.auth.user.orgId
const sessions = await request.server.withTenantTx(orgId, (trx) =>
  deps.storage.listSessions(trx, { orgId, projectId, limit }),
)
```

(A valid uuid passes through; anything else — including `undefined` — yields `undefined`, i.e. no filter.)

- [ ] **Step 4: Run the test — expect PASS**

Run: `pnpm --filter @argus/server exec vitest run test/api/routes.test.ts`
Expected: PASS (all tests including the new one and the existing `filters by projectId`).

- [ ] **Step 5: Typecheck + lint**

Run: `pnpm --filter @argus/server typecheck && pnpm --filter @argus/server lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/modules/api/routes.ts apps/server/test/api/routes.test.ts
git commit -m "$(cat <<'EOF'
fix(server): ignore non-uuid projectId on GET /api/sessions

A stale or malformed projectId query value previously reached Postgres
and produced a 500. Validate it as a uuid and treat anything else as
absent (return all sessions).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Frontend — `use-project-filter` stores the project id

**Files:**

- Modify: `apps/web/src/lib/use-project-filter.ts`

- [ ] **Step 1: Rewrite the hook to key on id**

Replace the entire contents of `apps/web/src/lib/use-project-filter.ts` with:

```ts
import { useNavigate, useSearch } from '@tanstack/react-router'

const PROJECT_KEY = 'argus.projectId'

function readStored(): string | null {
  return typeof localStorage !== 'undefined' ? localStorage.getItem(PROJECT_KEY) : null
}

/**
 * The active project filter, keyed on project id (not name) so a project
 * rename never orphans the selection. Read from the `?projectId=` search param,
 * falling back to localStorage. `setProject` takes a project id or null.
 */
export function useProjectFilter() {
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as { projectId?: string }
  const project = search.projectId ?? readStored() ?? null

  function setProject(next: string | null) {
    if (next) localStorage.setItem(PROJECT_KEY, next)
    else localStorage.removeItem(PROJECT_KEY)
    void navigate({ to: '/sessions', search: next ? { projectId: next } : {} })
  }

  return { project, setProject }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @argus/web typecheck`
Expected: FAIL (expected at this point) — `sessions/index.tsx` still validates `{ project?: string }` and passes the (now-id) `project` into `filterSessionsByProject`/name lookup; the switcher/rail/detail still reference the old behavior. These are fixed in Tasks 3–6. Note the errors and proceed; do NOT commit yet.

> Rationale for committing later: this hook change alone leaves the tree non-compiling, so it is committed together with its consumers in Task 6's final green state would be ideal — BUT to keep commits small, each of Tasks 3–6 leaves the build green on its own after this task. To make that true, do Task 2 and Task 3 back-to-back before committing. Therefore: **do not commit at the end of Task 2; commit at the end of Task 3** (which restores a green typecheck). Tasks 4–6 each keep it green and commit individually.

---

## Task 3: Frontend — sessions list uses the id directly (+ commit Tasks 2–3)

**Files:**

- Modify: `apps/web/src/routes/sessions/index.tsx`

- [ ] **Step 1: Update imports**

In `apps/web/src/routes/sessions/index.tsx`, change line 5 + line 8. Remove `fetchProjects` (no longer needed) and `filterSessionsByProject` (going away):

```ts
import { fetchSessions } from '../../lib/api'
```

```ts
import { listDurationLabel } from '../../lib/sessions-select'
```

(Keep the other imports: `createFileRoute, Link, useNavigate`, `useQuery`, `useEffect`, `Trans, useTranslation`, `useLocaleFormat`, `useProjectFilter`.)

- [ ] **Step 2: Switch `validateSearch` to `projectId`**

Replace the `validateSearch` (lines 11-13):

```ts
  validateSearch: (search: Record<string, unknown>): { projectId?: string } => ({
    projectId: typeof search.projectId === 'string' ? search.projectId : undefined,
  }),
```

- [ ] **Step 3: Drop the name→id lookup and client filter**

Replace the query + derivation block (current lines 21-34):

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

with:

```ts
const { project } = useProjectFilter()
const { data, isLoading, error } = useQuery({
  queryKey: ['sessions', project ?? null],
  queryFn: () => fetchSessions(project ?? undefined),
  retry: false,
})
const rows = data?.sessions ?? []
```

Everything else in the file is unchanged. `project` is now the id; the `!project` checks that hide the Project column/cell still work (truthy check, id-agnostic). The empty-state branch `if (!data || data.sessions.length === 0)` is unchanged. `listDurationLabel` and `f.dateTime` are still used in the rows.

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm --filter @argus/web typecheck && pnpm --filter @argus/web lint`
Expected: typecheck still FAILS, but now only in `ProjectSwitcher.tsx`, `$sessionId.tsx`, `SessionRail.tsx`, and `sessions-select.test.ts` (the switcher still calls `setProject(name)` semantics fine, but `$sessionId`/`SessionRail` still import/use `filterSessionsByProject`). `sessions/index.tsx` itself should have no errors. If `sessions/index.tsx` reports an error, fix it before moving on.

> Do NOT commit yet — the tree still doesn't compile because the rail and detail still use `filterSessionsByProject`. Proceed to Task 4.

---

## Task 4: Frontend — session rail filters server-side by id

**Files:**

- Modify: `apps/web/src/features/session-replay/rail/SessionRail.tsx`

- [ ] **Step 1: Update imports + query**

In `apps/web/src/features/session-replay/rail/SessionRail.tsx`:

(a) Remove the `filterSessionsByProject` import (line 7) — delete that whole import line.

(b) Replace the query + rows derivation (lines 14-20):

```ts
const { project } = useProjectFilter()
const { data } = useQuery({
  queryKey: ['sessions', project ?? null],
  queryFn: () => fetchSessions(project ?? undefined),
  retry: false,
})
const rows = data?.sessions ?? []
```

Everything else (the collapsed/expanded render, the `rows.map`) is unchanged.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @argus/web typecheck`
Expected: still FAILS only in `$sessionId.tsx` (uses `filterSessionsByProject`) and `sessions-select.test.ts`. `SessionRail.tsx` itself clean. Proceed; don't commit yet.

---

## Task 5: Frontend — session detail filters siblings server-side by id

**Files:**

- Modify: `apps/web/src/routes/sessions/$sessionId.tsx`

- [ ] **Step 1: Update imports + sibling query**

In `apps/web/src/routes/sessions/$sessionId.tsx`:

(a) Change the sessions-select import (line 8) to drop `filterSessionsByProject`:

```ts
import { adjacentSessions } from '../../lib/sessions-select'
```

(b) Replace the sibling-list query + filter (current lines 40-47):

```ts
const { data: list } = useQuery({
  queryKey: ['sessions', project ?? null],
  queryFn: () => fetchSessions(project ?? undefined),
  retry: false,
})
const stream = useSessionStream(sessionId)

const siblings = list?.sessions ?? []
const { prev, next } = adjacentSessions(siblings, sessionId)
```

(`project` from `useProjectFilter()` is the id; the server already returns only that project's sessions, so the client filter is gone. `adjacentSessions` is unchanged.)

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm --filter @argus/web typecheck && pnpm --filter @argus/web lint`
Expected: typecheck now FAILS only in `sessions-select.test.ts` (it imports `filterSessionsByProject`, still defined, so actually it still compiles) — in practice after this task the app source compiles; the only remaining issue is the orphaned function + its test, handled in Task 6. If lint flags `filterSessionsByProject` as unused in `sessions-select.ts`, that's expected and fixed in Task 6. Do NOT commit yet.

---

## Task 6: Frontend — switcher selects by id; delete orphaned helper; commit the frontend

**Files:**

- Modify: `apps/web/src/components/layout/ProjectSwitcher.tsx`, `apps/web/src/lib/sessions-select.ts`, `apps/web/src/lib/sessions-select.test.ts`

- [ ] **Step 1: Switcher — select by id, display name**

Replace the body of `ProjectSwitcher` in `apps/web/src/components/layout/ProjectSwitcher.tsx` (keep the imports at top unchanged). Replace lines 15-43 (everything inside `export function ProjectSwitcher() { ... }`) with:

```ts
export function ProjectSwitcher() {
  const { t } = useTranslation()
  const { project, setProject } = useProjectFilter()
  const { data } = useQuery({ queryKey: ['projects'], queryFn: fetchProjects, retry: false })
  const projects = data?.projects ?? []
  const current = projects.find((p) => p.id === project)?.name ?? t('shell.project.all')

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded border border-hairline px-2 py-1.5 u-body text-text-1 hover:bg-tile">
        <span className="truncate">{current}</span>
        <ChevronsUpDown className="ml-auto size-3.5 text-text-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]">
        <DropdownMenuItem onSelect={() => setProject(null)}>
          <span>{t('shell.project.all')}</span>
          {project === null && <Check className="size-3.5 text-brand" />}
        </DropdownMenuItem>
        {projects.length > 0 && <DropdownMenuSeparator />}
        {projects.map((p) => (
          <DropdownMenuItem key={p.id} onSelect={() => setProject(p.id)}>
            <span className="truncate" title={p.name}>
              {p.name}
            </span>
            {project === p.id && <Check className="size-3.5 text-brand" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
```

(The imports — `ChevronsUpDown, Check`, `useQuery`, `useTranslation`, `fetchProjects`, `useProjectFilter`, and the dropdown-menu components — are all still used and unchanged.)

- [ ] **Step 2: Delete the orphaned `filterSessionsByProject`**

In `apps/web/src/lib/sessions-select.ts`, delete the first export (lines 3-9):

```ts
export function filterSessionsByProject(
  sessions: SessionSummary[],
  project: string | null,
): SessionSummary[] {
  if (!project) return sessions
  return sessions.filter((s) => s.projectName === project)
}
```

Keep `adjacentSessions`, `listDurationLabel`, and the `import type { SessionSummary } from '@argus/shared-types'` line (still used by both).

- [ ] **Step 3: Confirm nothing else imports it**

Run: `grep -rn "filterSessionsByProject" apps/web/src`
Expected: matches ONLY in `apps/web/src/lib/sessions-select.test.ts` (the test, removed next). If any source file still references it, stop and fix that file — do not leave a dangling import.

- [ ] **Step 4: Remove its test block + import entry**

In `apps/web/src/lib/sessions-select.test.ts`:

(a) Change the import (line 2) to drop `filterSessionsByProject`:

```ts
import { adjacentSessions, listDurationLabel } from './sessions-select'
```

(b) Delete the entire `describe('filterSessionsByProject', () => { ... })` block (lines 18-26):

```ts
describe('filterSessionsByProject', () => {
  const list = [s({ id: 'a', projectName: 'alpha' }), s({ id: 'b', projectName: 'beta' })]
  it('returns all when project is null', () => {
    expect(filterSessionsByProject(list, null).map((x) => x.id)).toEqual(['a', 'b'])
  })
  it('filters by project name', () => {
    expect(filterSessionsByProject(list, 'beta').map((x) => x.id)).toEqual(['b'])
  })
})
```

Leave the `adjacentSessions` and `listDurationLabel` describes and the `s()` factory intact.

- [ ] **Step 5: Full web gate**

Run: `pnpm --filter @argus/web typecheck && pnpm --filter @argus/web lint && pnpm --filter @argus/web test && pnpm --filter @argus/web build`
Expected: ALL PASS. (`grep -rn "filterSessionsByProject" apps/web/src` now returns nothing.)

- [ ] **Step 6: Commit the whole frontend change (Tasks 2–6)**

```bash
git checkout -- apps/web/src/routeTree.gen.ts 2>/dev/null || true
git add apps/web/src/lib/use-project-filter.ts apps/web/src/routes/sessions/index.tsx apps/web/src/features/session-replay/rail/SessionRail.tsx apps/web/src/routes/sessions/\$sessionId.tsx apps/web/src/components/layout/ProjectSwitcher.tsx apps/web/src/lib/sessions-select.ts apps/web/src/lib/sessions-select.test.ts
git commit -m "$(cat <<'EOF'
feat(web): key project filter on id instead of name

The active project is now stored as its id (URL ?projectId=, localStorage
argus.projectId). The sessions list, rail, and detail filter server-side
via fetchSessions(projectId); the switcher selects by id and displays the
name. The client-side filterSessionsByProject helper is removed. A stored
name from the old key cleanly resets to all-projects.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

> Note: this single frontend commit spans Tasks 2–6 because the hook change (Task 2) doesn't compile until its consumers are updated. That's intentional — the repo never commits a non-compiling state. The backend Task 1 was a separate, independently-green commit.

---

## Final verification

- [ ] `pnpm --filter @argus/server test` → all pass (incl. the non-uuid test + existing projectId filter). Needs test Postgres.
- [ ] `pnpm --filter @argus/server typecheck && pnpm --filter @argus/server lint` → clean.
- [ ] `pnpm --filter @argus/web typecheck && pnpm --filter @argus/web lint && pnpm --filter @argus/web test && pnpm --filter @argus/web build` → all pass.
- [ ] `grep -rn "filterSessionsByProject" apps/web/src` → no matches.
- [ ] `grep -rn "argus.project'" apps/web/src` → no matches (old localStorage key gone); `grep -rn "argus.projectId" apps/web/src` → 1 match in `use-project-filter.ts`.
- [ ] Manual (dev server, logged in): pick a project in the switcher → URL shows `?projectId=<uuid>`, list filters, trigger shows the project **name**; reload → still filtered (localStorage); rename-safety is structural (id-keyed). "All projects" clears it. Open a session detail → prev/next stay within the selected project; rail list is scoped too.

---

## Self-review (completed by plan author)

- **Spec coverage:** id in URL+localStorage+hook (T2) ✓; param `project`→`projectId` + key rename (T2) ✓; all three consumers server-side (T3/T4/T5) ✓; switcher select-by-id/display-name (T6) ✓; delete `filterSessionsByProject` + test (T6) ✓; backend non-uuid guard + test (T1) ✓. No new i18n strings (uses existing `shell.project.all`) ✓.
- **Commit-granularity note (intentional deviation from one-commit-per-task):** Task 2 (the hook) doesn't compile standalone, so Tasks 2–6 land as ONE frontend commit at a green state; Task 1 (backend) is its own green commit. Each commit compiles + passes its gates. This is called out explicitly so the executor doesn't try to commit a broken tree after Task 2.
- **Type consistency:** `useProjectFilter()` returns `{ project: string|null, setProject(string|null) }` throughout — `project` now holds an id; consumers pass `project ?? undefined` to `fetchSessions(projectId?: string)` (matches the ① signature); switcher compares `project === p.id`; queryKey `['sessions', project ?? null]` consistent across list/rail/detail. `adjacentSessions`/`listDurationLabel` signatures unchanged.
- **Placeholder scan:** none — every step has complete code/commands.
- **routeTree guard:** this feature changes no routes; the plan explicitly excludes `routeTree.gen.ts` from every commit and resets it before staging.
