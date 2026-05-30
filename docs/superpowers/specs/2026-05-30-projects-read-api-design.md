# Projects Read API + Backend Session Filtering — Design

**Date:** 2026-05-30
**Status:** Approved design (brainstorming output)
**Scope:** Sub-project ① of three. Add an authoritative `GET /api/projects` endpoint and push session filtering from the client down to the backend. This replaces the temporary client-side `distinctProjects(sessions)` dedup. The URL scope shape is unchanged (still `?project=<name>`), deferred to sub-project ②.

## Context: this is sub-project ① of three

The broader goal ("real `/projects` support") decomposes into three independently-shippable pieces, in dependency order:

1. **① Read API + backend filtering (this spec).** Authoritative project list + `?projectId=` filter on sessions. Ships alone; removes the client-side dedup hack. The other two depend on it.
2. **② Path scope `/p/$projectId`.** Frontend route refactor; moves `?project=name` to a path scope keyed on id. Touches the just-shipped shell routing. Separate spec.
3. **③ Project CRUD.** Create/rename/delete + a Settings management page. Includes destructive delete (cascade) design. Separate spec.

This spec covers **only ①**. ② and ③ are explicitly out of scope.

## Verified facts (read from the code on 2026-05-30)

- **`sessions.project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE`** exists (`apps/server/src/db/migrations/0001_init.ts:30`). So sessions can be filtered by `project_id` directly — no name-based fallback or extra join needed.
- **`pg-storage.listSessions`** already `innerJoin('projects', 'projects.id', 'sessions.project_id')` (`apps/server/src/modules/storage/pg-storage.ts:71`), so it has `projects` in scope. Adding a `.where('sessions.project_id', '=', projectId)` is a one-line conditional.
- **`ListSessionsParams = { orgId, limit }`** (`apps/server/src/modules/storage/types.ts:30`). Gains an optional `projectId?: string`.
- **`projects` table:** `id`, `org_id`, `name`, `created_at`; unique `(org_id, name)`; RLS + FORCE RLS with `tenant_isolation` policy on `argus.current_org_id`; `argus_app` has SELECT (`migrations/0001_init.ts`, `0003_grants.ts`).
- **Route pattern:** `GET /api/sessions` (`apps/server/src/modules/api/routes.ts:10`) → 401 if `!request.auth`; `orgId = request.auth.user.orgId`; query via `request.server.withTenantTx(orgId, trx => storage.listSessions(trx, ...))`; maps rows to ISO-string DTOs. Routes registered in `apps/server/src/server.ts:105` inside the auth-gated scope.
- **shared-types** (`packages/shared-types/src/api.ts`): `SessionSummarySchema`, `ListSessionsResponseSchema`, etc. No Project schema yet. Pattern: `const XSchema = z.object(...)` + `export type X = z.infer<typeof XSchema>`.
- **Frontend:** `lib/api.ts` `fetchSessions()` parses `ListSessionsResponseSchema`. `ProjectSwitcher.tsx:18` derives projects via `distinctProjects(data.sessions)`. `use-project-filter.ts` stores the active project **name** in `?project=` + localStorage.
- **Tests:** backend integration tests use `createTestDb()` (super-user pool) to seed, a mock app injecting `req.auth` in a `preHandler`, and `withTenantTx` / RLS isolation assertions (`test/tokens/routes.test.ts`, `test/db-tenant/tenant-isolation.integration.test.ts`).

## Design

### Backend

**New endpoint `GET /api/projects`** — registered alongside the existing api routes in the auth-gated scope. Handler mirrors `GET /api/sessions`:

```
if (!request.auth) → 401 { error: 'unauthenticated' }
orgId = request.auth.user.orgId
rows = await server.withTenantTx(orgId, trx =>
  trx.selectFrom('projects')
     .select(['id', 'name', 'created_at'])
     .where('org_id', '=', orgId)
     .orderBy('name')
     .execute())
return { projects: rows.map(r => ({ id, name, createdAt: created_at.toISOString() })) }
```

RLS enforces tenant isolation at the DB layer; the `where org_id` clause is retained for index efficiency + defense in depth (per CLAUDE.md). This query is a plain SELECT, so it could run on `deps.db` like tokens — but it uses `withTenantTx` to stay consistent with the sessions route and to keep the RLS GUC set. Either is correct; the plan uses `withTenantTx` for consistency.

**Modify `GET /api/sessions`** — accept an optional `?projectId=` query param:

- Parse `projectId` (optional string) from `request.query`.
- Pass it through to `storage.listSessions(trx, { orgId, projectId, limit })`.
- Backward compatible: omitting `projectId` leaves behavior identical.

**Modify the storage layer:**

- `ListSessionsParams` gains `projectId?: string`.
- `pg-storage.listSessions` adds `if (projectId) qb = qb.where('sessions.project_id', '=', projectId)` before execution. Filter by **id**, not name.

### Shared types (`packages/shared-types/src/api.ts`)

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

`ListSessionsResponseSchema` is unchanged (the request gains an optional query param; the response shape does not change).

### Frontend

- **`lib/api.ts`:**
  - Add `fetchProjects(): Promise<ListProjectsResponse>` → parses `ListProjectsResponseSchema` from `/api/projects`.
  - `fetchSessions(projectId?: string)` → appends `?projectId=<id>` when provided.
- **`use-project-filter.ts`:** unchanged contract — `?project=` continues to store the project **name** this round (URL契约不变；id 化留给 ②). Consumers that need to filter sessions by id resolve name→id from the `fetchProjects()` result.
- **`ProjectSwitcher.tsx`:** data source changes from `distinctProjects(useQuery(sessions))` to `useQuery({ queryKey: ['projects'], queryFn: fetchProjects })`. The dropdown lists `project.name` (selection still keyed on name, matching the unchanged `?project=` contract).
- **Sessions list (`routes/sessions/index.tsx`):** when a project name is active, resolve it to an id via the `projects` query and pass `projectId` to `fetchSessions`, so filtering happens server-side. If the projects query hasn't resolved yet, fall back to the existing client-side `filterSessionsByProject` so there's no flempty flash. (Both paths converge on the same result.)
- **`sessions-select.ts`:** `distinctProjects` becomes orphaned once `ProjectSwitcher` stops using it — **delete it and its test** (it was added in the shell work; removing a self-created orphan). `filterSessionsByProject` is still used (SessionRail, the fallback above) — keep it. `adjacentSessions`, `listDurationLabel` — keep.

### Tests

**Backend integration** (new `test/api/projects.test.ts`, mirroring `test/tokens/routes.test.ts`):

- `GET /api/projects` without auth → 401.
- Returns the authenticated org's projects, ordered by name.
- **Tenant isolation:** org B sees none of org A's projects.
- `GET /api/sessions?projectId=<id>` returns only that project's sessions; an id from another org returns none (RLS); omitting `projectId` returns all (regression).

**Frontend:**

- `fetchProjects` / `fetchSessions(projectId)` are thin wrappers — not unit-tested (consistent with `fetchSessions` today).
- Delete `sessions-select.test.ts`'s `distinctProjects` block along with the function. The remaining helpers keep their tests.

## Out of scope (sub-projects ② and ③)

- Path scope `/p/$projectId`; changing `?project=` to store an id. → ②
- "All projects" as a first-class state vs. a landing page. → ②
- Create / rename / delete projects; Settings management page; cascade-delete design; audit events. → ③

## Risks / notes

- The only prior unknown (sessions↔project linkage) is resolved: `sessions.project_id` FK exists, so id-based filtering is clean.
- Name→id resolution on the frontend is a deliberate bridge so ① doesn't change the `?project=` URL contract. It becomes unnecessary once ② keys the scope on id.
- i18n: no new user-facing strings are required (the switcher already uses `shell.project.all`; project names are data, not translated copy). If any string is added, it goes into all three locales per the parity test.
