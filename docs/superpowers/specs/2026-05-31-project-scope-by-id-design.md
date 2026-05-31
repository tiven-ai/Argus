# Project Scope by ID (rename-safe) — Design

**Date:** 2026-05-31
**Status:** Approved design (brainstorming output)
**Scope:** Sub-project ②-lite of the projects work. Make the active-project selection key on the project **id** instead of its **name**, so renaming a project (sub-project ③) won't orphan the selection. This finishes pushing all session filtering to the server. It does **not** introduce a path scope (`/p/$projectId`) — that fuller refactor was considered and deliberately dropped as not worth its cost.

## Context: where this sits

The projects work decomposed into three sub-projects:

1. **① Read API + backend filtering — done** (merged `86c453b`). `GET /api/projects`, optional `?projectId=` on `GET /api/sessions`, switcher reads the endpoint.
2. **② Project scope by id (this spec).** Active project stored as id everywhere (URL, localStorage, `useProjectFilter`); all session filtering server-side. The `?project=name` query scope shape stays (just renamed and re-valued) — no `/p/$projectId` path scope.
3. **③ Project CRUD — separate spec, next.** Create / rename / delete + Settings management page. ② exists so that ③'s rename is safe.

This spec covers **only ②-lite**.

## Why id, not name (the one real win)

Today the active project is the project **name** (`?project=<name>`, localStorage `argus.project`), and the sessions list / rail / detail filter client-side by `session.projectName`. If a project is renamed (③), every stored selection and shared link silently points at a name that no longer exists. Keying on the immutable id removes that whole class of bug. The fuller `/p/$projectId` path scope would add prettier URLs and breadcrumbs but requires restructuring the just-shipped shell routing for no functional gain here — out of scope.

## Verified facts (read from the code on 2026-05-31)

- **`use-project-filter.ts`** (full file): `PROJECT_KEY = 'argus.project'`; reads `search.project` (via `useSearch({ strict: false })`) → localStorage → null; `setProject(next)` writes localStorage and `navigate({ to: '/sessions', search: next ? { project: next } : {} })`.
- **`SessionSummary`** has `projectName`, NOT `projectId`. So a client-side filter can only match by name. Once the active value is an id, client-side name-matching is impossible — filtering must be server-side (which `fetchSessions(projectId)` already supports from ①).
- **`sessions/index.tsx`** (post-①): reads `project` (name), looks it up in `fetchProjects()` to get `projectId`, calls `fetchSessions(projectId)`, then _also_ `filterSessionsByProject(data.sessions, project)` as a convergence fallback. Validates `?project=` search as `{ project?: string }`. Hides the Project column when `project` is truthy.
- **`$sessionId.tsx`** (post-①): `fetchSessions()` (ALL sessions, no filter) then `siblings = filterSessionsByProject(list.sessions, project)` then `adjacentSessions(siblings, sessionId)`. Search schema is `{ round?: string }` only.
- **`SessionRail.tsx`** (post-①): `fetchSessions()` (ALL) then `filterSessionsByProject(data.sessions, project)`.
- **`ProjectSwitcher.tsx`** (post-①): `fetchProjects()` → `data.projects.map(p => p.name)`; `current = project ?? t('shell.project.all')`; selecting calls `setProject(p.name)`; checkmark when `project === name`.
- **`sessions-select.ts`** exports `filterSessionsByProject`, `adjacentSessions`, `listDurationLabel`. `filterSessionsByProject` is used by `index.tsx`, `$sessionId.tsx`, `SessionRail.tsx`. `adjacentSessions` used by `$sessionId.tsx`; `listDurationLabel` by `index.tsx`.
- **Backend `GET /api/sessions`** (`apps/server/src/modules/api/routes.ts:15-20`): `const query = request.query as { limit?: string; projectId?: string }`; passes `query.projectId` straight to `listSessions`. A non-uuid value would reach Postgres and error (`invalid input syntax for type uuid`) → 500.
- **`ProjectSummary`** = `{ id, name, createdAt }`. No server-side "current project" concept; selection is purely client state.

## Design

### Frontend

**`use-project-filter.ts` — the value becomes an id:**

- Rename the localStorage key `'argus.project'` → `'argus.projectId'`. (A stale old-key value is simply not read, so any previously-stored name cleanly drops to "all projects" — no garbage id is ever sent to the server.)
- Rename the URL search param `project` → `projectId`. (The value semantics changed from name to id, so old `?project=name` links break either way; renaming makes that honest and avoids a name-valued `?project=` lingering.)
- `setProject(next)` navigates `{ to: '/sessions', search: next ? { projectId: next } : {} }`.
- The returned `project` value is now the active project **id** (`string | null`). The variable stays named `project` in the hook's return for minimal churn; it simply holds an id now.

**Consumers — all filtering goes server-side:**

- **`sessions/index.tsx`:** `project` is already the id, so delete the `fetchProjects()` name→id lookup and the `filterSessionsByProject` fallback. Call `fetchSessions(project ?? undefined)` with queryKey `['sessions', project ?? null]`. Update `validateSearch` to `{ projectId?: string }` and read it. The "hide Project column when a project is active" check (`!project`) is unchanged (id-agnostic).
- **`$sessionId.tsx`:** replace `fetchSessions()` + `filterSessionsByProject(list.sessions, project)` with `fetchSessions(project ?? undefined)` (queryKey `['sessions', project ?? null]`); `siblings` becomes `list?.sessions ?? []`; keep `adjacentSessions(siblings, sessionId)`.
- **`SessionRail.tsx`:** replace `fetchSessions()` + `filterSessionsByProject` with `fetchSessions(project ?? undefined)` (queryKey `['sessions', project ?? null]`); `rows = data?.sessions ?? []`.

**`ProjectSwitcher.tsx` — select by id, display name:**

- Keep the full project objects from `fetchProjects()` (don't map to names). The dropdown items iterate `data.projects`; each calls `setProject(p.id)` and shows `p.name`; checkmark when `project === p.id`.
- The trigger label resolves the active id to a name: `data.projects.find(p => p.id === project)?.name ?? t('shell.project.all')`.

**`sessions-select.ts`:** `filterSessionsByProject` is now unused → **delete it and its test block**. Keep `adjacentSessions`, `listDurationLabel` (still used) and their tests.

### Backend (one small hardening)

**`GET /api/sessions` — tolerate a non-uuid `projectId`:** validate `query.projectId` as an optional uuid; if it is present but not a valid uuid, treat it as absent (return all sessions) rather than passing it to Postgres. This protects against a stale `?projectId=<oldname>` link (and any malformed value) producing a 500. Implementation: a small guard in the route (e.g. a `z.string().uuid()` `safeParse`, passing `undefined` on failure). The storage layer is unchanged.

Add a backend test: `GET /api/sessions?projectId=not-a-uuid` returns 200 with all sessions (not 500).

### Tests

- **Backend:** the non-uuid guard test above, added to `apps/server/test/api/routes.test.ts`.
- **Frontend:** delete the `filterSessionsByProject` describe block from `sessions-select.test.ts` (the function is gone). The thin fetch wrappers and id-based selection are verified by typecheck + the dev server; no new unit tests (consistent with the project's existing test scope — hooks/components that depend on router/query context aren't unit-tested here).

## Out of scope

- `/p/$projectId` path scope, breadcrumb showing the project name, "All projects" as a landing page. (Deliberately dropped — fuller refactor, no functional gain for ②.)
- Project create / rename / delete + Settings management page. → ③.
- Any change to `ProjectSummary` / `SessionSummary` shapes (no `projectId` added to `SessionSummary`; filtering is by id at query time, display still uses `projectName`).

## Risks / notes

- **Breaking change for existing users' stored selection / shared links:** intended and clean — a stored name (old key) or a `?project=name` link resolves to "all projects" (the key rename means the old value isn't read; the param rename means the old param is ignored). No error, just a reset to the default view.
- **`?projectId` is not validated as a real owned project on the client** — an arbitrary uuid simply returns an empty session list (RLS + the filter ensure no cross-org leak). Acceptable; the switcher only ever sets real ids.
- i18n: no new user-facing strings (the switcher already uses `shell.project.all`; project names are data). If any string is added, it goes into all three locales per the parity test.
