# Project CRUD + Settings Management — Design

**Date:** 2026-05-31
**Status:** Approved design (brainstorming output)
**Scope:** Sub-project ③ (final) of the projects work. Add create / rename / delete for projects (backend routes + audit) and a Settings → Projects management page. Delete is destructive (cascades to services → sessions → steps → step_events and ingest_tokens) and is gated behind type-the-name confirmation.

## Context: where this sits

The projects work decomposed into three sub-projects:

1. **① Read API + backend filtering — done** (`86c453b`). `GET /api/projects`, `?projectId=` filter.
2. **②-lite Project scope by id — done** (`d0b0de3`). Active project keyed on id; rename-safe; backend non-uuid guard.
3. **③ Project CRUD (this spec).** Create / rename / delete + a Settings management page. ② made the selection id-keyed precisely so ③'s rename is safe.

This is the last of the three.

## Verified facts (read from the code on 2026-05-31)

- **Cascade is fully DB-handled.** `DELETE FROM projects WHERE id = $1` cascades the entire tree via `ON DELETE CASCADE` FKs: `services.project_id` → `sessions.service_id` → `steps.session_id` → `step_events.step_id`, plus `ingest_tokens.project_id` (migrations `0001_init.ts`, `0002_auth.ts`). No application-level child deletes are needed; the delete is atomic.
- **`projects` unique constraint** is `projects_org_name_unique (org_id, name)` (`0001_init.ts:23`) — names unique within an org; different orgs may reuse a name. Rename/create must handle this.
- **`projects` is under FORCE RLS** — every query runs inside `app.withTenantTx(orgId, trx => ...)` (sets the `argus.current_org_id` GUC). Direct `db` queries would see 0 rows / violate WITH CHECK.
- **`AuditEventType` already contains** `'project_create' | 'project_rename' | 'project_delete'` (`apps/server/src/modules/audit/types.ts:9-11`). No type change needed — just call `record()`.
- **`audit record()`** (`audit/index.ts`/`record.ts`) signature: `record(trx, { eventType, actorUserId, targetKind?, targetId?, metadata?, ip?, userAgent? })`. It reads the org from the GUC; must run inside `withTenantTx`. Existing `targetKind` values include `'ingest_token'`; this work uses `targetKind: 'project'`.
- **Write-path pattern to copy** (`tokens/routes.ts`): zod `safeParse` the body → 400 `{ error: 'invalid_input', issues }` on failure; `app.withTenantTx(orgId, async (trx) => { const rec = await dao(...); await record(trx, {...}); return rec })`; ownership-miss returns `false` from the DAO → route replies 404 `{ error: 'not_found' }`.
- **Current `projectRoutes`** (`apps/server/src/modules/projects/routes.ts`) is `FastifyPluginAsync` with **no deps** and only `GET /api/projects`. Registered in `server.ts` as `await scope.register(projectRoutes)` inside the auth-gated scope. `tokenManagementRoutes` is registered with `{ db }` — same pattern to follow when this route needs nothing beyond `withTenantTx` (it doesn't need `db`; audit + DAO both run on `trx`).
- **`projects/dao.ts`** currently exports `listProjectsForOrg(trx, orgId)` returning `ProjectRow { id, name, createdAt }`.
- **shared-types** (`api.ts`): `ProjectSummarySchema { id, name, createdAt }`, `ListProjectsResponseSchema { projects: [] }`. No create/rename/delete schemas yet.
- **Frontend Settings**: `routes/settings/route.tsx` is a layout `<Outlet/>`; `routes/settings/tokens.tsx` is the one real page (useQuery + useMutation + `queryClient.invalidateQueries`). `nav-config.ts` `SETTINGS_NAV`: `tokens` (real), `members`/`general`/`integrations` (`soon`).
- **Frontend project consumers (post-②)**: `useProjectFilter` stores project **id**; `ProjectSwitcher` reads `['projects']`; sessions list/rail/detail key `['sessions', projectId]`. Deleting the _currently-selected_ project must reset the filter to null.
- **i18n**: parity test enforces identical keys across `en/zh-CN/ja`. Existing `shell.settingsNav.*`, `shell.project.*`.
- **Tests**: backend route tests use `createAppRoleTestDb()` (RLS-respecting app role) + super-user `admin` (`createTestDb()`) for seeding/asserting; `truncateAll(admin)` per test. `apps/server/test/api/projects.routes.test.ts` already exists (from ①) with `ORG_A`/`ORG_B`, a `seedProjects` helper, and the `authedOrgId` toggle pattern.

## Design

### Backend — three new routes on the projects module

`projectRoutes` stays a `FastifyPluginAsync` with no deps (everything runs on `trx`). All routes 401 when `!request.auth`; all wrap DAO + audit in one `app.withTenantTx(orgId, ...)`.

**`POST /api/projects`** — create.

- Body: `{ name: string }` (zod `min(1).max(255)`; 400 on invalid).
- DAO `createProject(trx, orgId, name)`: insert; on `(org_id, name)` unique violation return a sentinel (or pre-check) so the route replies **409** `{ error: 'conflict' }`.
- Audit `project_create`, `targetKind: 'project'`, `targetId: newId`, `metadata: { name }`.
- Returns `{ project: { id, name, createdAt } }`.

**`PATCH /api/projects/:id`** — rename.

- Body: `{ name: string }` (same validation).
- DAO `renameProject(trx, orgId, id, name)`: update `WHERE id AND org_id`; returns the updated row, `null` if not found (→ 404), or a conflict sentinel on unique violation (→ 409).
- Audit `project_rename`, `metadata: { name }` (the new name; keep it simple per the chosen audit granularity — id is in `targetId`).
- Returns `{ project: { id, name, createdAt } }`.

**`DELETE /api/projects/:id`** — destructive delete.

- DAO `deleteProject(trx, orgId, id)`: `DELETE FROM projects WHERE id AND org_id` (cascade does the rest); returns whether a row was deleted (`false` → 404). Capture the project name before deletion for the audit metadata.
- Audit `project_delete`, `targetKind: 'project'`, `targetId: id`, `metadata: { name }`.
- Returns `{ ok: true }`.

**Conflict handling:** detect the unique-constraint violation. Preferred: pre-check `SELECT 1 FROM projects WHERE org_id = ? AND name = ?` (excluding the same id on rename) inside the tx and return a conflict sentinel → route maps to 409. (A pre-check inside the tenant tx is race-safe enough for this single-user-per-org app; the DB constraint remains the backstop.)

### shared-types

```ts
ProjectBodySchema = z.object({ name: z.string().min(1).max(255) }) // create + rename body
ProjectResponseSchema = z.object({ project: ProjectSummarySchema }) // create + rename response
DeleteProjectResponseSchema = z.object({ ok: z.boolean() }) // delete response
```

(`ProjectSummary` already has `{ id, name, createdAt }`.) Export inferred types.

### Frontend

**`lib/api.ts`** — add `createProject({ name })`, `renameProject(id, { name })`, `deleteProject(id)`. Each parses its response schema; throws on non-ok (the existing `fetchJson` throws `HTTP <status>` — the page maps 409 to a "name taken" message by inspecting the thrown message, consistent with how the app surfaces errors today).

**Nav** — add a real `projects` entry to `SETTINGS_NAV` between `tokens` and `members`: `{ key: 'projects', labelKey: 'shell.settingsNav.projects', icon: FolderOpen, to: '/settings/projects' }`. The `soon` entries are untouched.

**`routes/settings/projects.tsx`** — new page, mirroring `tokens.tsx`:

- `useQuery(['projects'], fetchProjects)`.
- **Create**: a small form (name input + submit) → `createProject` mutation → on success invalidate `['projects']` and clear the input; on 409 show a "name already exists" inline error.
- **List**: each project row shows name + created date + **Rename** and **Delete** actions.
- **Rename**: inline edit (or a small dialog) → `renameProject` → invalidate `['projects']`; 409 → inline error.
- **Delete**: a confirmation dialog requiring the user to **type the exact project name** to enable the destructive button; the dialog text states it will permanently delete the project and all its services, sessions, steps, and tokens. On success: invalidate `['projects']`, invalidate `['sessions']`, and **if the deleted id is the active `useProjectFilter` project, call `setProject(null)`**.

**Cache + active-filter coherence:**

- Create → invalidate `['projects']`.
- Rename → invalidate `['projects']` (id unchanged, so the active filter and `['sessions']` stay valid; the switcher label updates).
- Delete → invalidate `['projects']` + `['sessions']`; reset the active filter to null if it pointed at the deleted project.

### Error handling

- Invalid body → 400 `{ error: 'invalid_input', issues }`.
- Duplicate name (create or rename) → 409 `{ error: 'conflict' }` → frontend inline "name already exists".
- Rename/delete of a non-existent or other-org project → 404 `{ error: 'not_found' }` (RLS + the `WHERE org_id` make cross-org invisible).
- Unauthenticated → 401.

### Tests

**Backend** (`apps/server/test/api/projects.routes.test.ts`, extending the existing file):

- POST creates + audits (`project_create`, `targetKind: 'project'`, `metadata.name`); duplicate name → 409.
- PATCH renames + audits (`project_rename`); rename to an existing name → 409; rename unknown id → 404.
- DELETE returns ok + audits (`project_delete`); **cascade test** — seed project→service→session→step→step_event + ingest_token, delete, assert all children gone (via the super-user `admin` pool); delete unknown id → 404; tenant isolation — org B cannot delete org A's project (404).

**Frontend**: the new `lib/api.ts` wrappers are thin (not unit-tested, consistent with the rest); the page is verified via typecheck + lint + dev server. i18n parity test must stay green (new keys in all three locales).

## Out of scope

- Soft-delete / archive / trash (delete is a hard cascade).
- Bulk delete, project transfer between orgs, per-project settings beyond name.
- Members/General/Integrations settings pages (still `soon`).
- Any change to how projects are auto-created on first ingest / token creation (that path stays; explicit create is additive).

## Risks / notes

- **Destructive delete** is the main risk; mitigated by type-the-name confirmation, a single atomic DB cascade (no partial deletes), an audit row, and a tenant-scoped `WHERE org_id` + RLS so you can only ever delete your own project.
- **Auto-created vs explicit projects are identical rows** — deleting one created implicitly by ingest behaves the same as deleting an explicit one. Expected.
- Active-filter reset on delete prevents the UI from sitting on a `?projectId=` that 404s/empties; the ②-lite non-uuid guard already prevents a 500, this just improves UX.
- i18n: all new strings (`shell.settingsNav.projects`, the `projects.*` page strings, delete-confirm copy) go in en/zh-CN/ja per the parity test.
