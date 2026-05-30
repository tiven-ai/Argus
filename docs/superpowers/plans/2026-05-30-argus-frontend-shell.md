# Argus Frontend Shell & Information Architecture — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the thin top-nav shell with a sidebar + thin-topbar application shell that exposes the org → project → session information architecture, a client-side project filter, "soon" placeholders for roadmap modules, and a master-detail session-detail page — reusing the existing UniFi tokens and the existing `SessionReplay` feature completely unchanged.

**Architecture:** A new `AppShell` wraps authenticated routes with a left `Sidebar` (org switcher, project switcher, module nav, settings, account menu) and a global `Topbar` (auto breadcrumb, theme toggle, ⌘K placeholder). Pure selection logic (distinct projects, project filtering, adjacent sessions) lives in a tested `src/lib/sessions-select.ts`; theme resolution in a tested `src/lib/theme.ts`. The session-detail **route** (`routes/sessions/$sessionId.tsx`) gains a collapsible session rail + prev/next; the `SessionReplay` feature component is not touched. Unauthenticated/auth routes bypass the shell and render their existing full-screen forms.

**Tech Stack:** React 19, TanStack Router + Query, Tailwind v4 (existing UniFi tokens in `index.css`), Radix UI primitives (adds `@radix-ui/react-dropdown-menu`), `lucide-react` icons, `react-i18next` (en / zh-CN / ja), Vitest for pure-logic unit tests.

---

## Source of truth (verified against current code on 2026-05-30)

The plan depends on these facts. If they have changed, re-verify before coding.

- **Session list shape** (`packages/shared-types/src/api.ts:26`): `SessionSummary = { id, traceId, projectName, serviceName, startedAt, endedAt: string|null, stepCount }`. **There is NO `status` and NO token-count field on the summary.** → The Sessions list adds a **Duration** column (from `startedAt`/`endedAt`) and keeps Project/Service/Trace/Steps/Started. **No status badge in the list** (corrects the spec mock; status is only derivable from steps, which the list does not fetch).
- **Session detail shape** (`api.ts:36`): `SessionDetail = SessionSummary + { steps: Step[] }`. Status/duration/tokens for the detail view are computed from `steps` by existing helpers in `features/session-replay/lib/step-helpers.ts` (`sessionStatus`, `sessionDurationMs`, `sessionTokens`, `formatDuration`).
- **Auth user** (`apps/web/src/lib/api.ts:25`): `AuthUser = { id, email, orgId, emailVerifiedAt }`. **No org name** is available. → `OrgSwitcher` shows a generic `shell.org.workspace` label, with `orgId` only in a `title` tooltip.
- **Root** (`apps/web/src/routes/__root.tsx`): `RootLayout` wraps `Shell` in `AuthProvider`; `useAuth()` → `{ user, loading, logout, ... }`. The shell currently renders for ALL routes (including `/login`).
- **i18n** (`apps/web/src/i18n/index.ts`, locales at `apps/web/src/i18n/locales/{en,zh-CN,ja}.json`): top-level namespaces today are `common, shell, auth, sessions, topbar, timeline, round, tool, tokens`. `shell` already has `nav`, `auth`, `language`, `verifyNag`. **A parity test (`apps/web/src/i18n/locale-parity.test.ts`) fails the build if the three files do not have an identical flattened key set.** Every key added to `en.json` MUST be added to `zh-CN.json` and `ja.json` in the same commit. Barrel exports: `SUPPORTED_LOCALES`, `LOCALE_LABELS`, `SupportedLocale`, default `i18n`.
- **`SessionReplay`** (`apps/web/src/features/session-replay/index.tsx`) signature: `{ session: SessionSummary, steps: Step[], activeRoundId: string|undefined, connected: boolean, onSelectRound: (id) => void }`. It already renders `SessionTopbar` + timeline + detail internally. **Phase 2 wraps it at the route level and does not modify it.**
- **Detail route** (`apps/web/src/routes/sessions/$sessionId.tsx`): uses `Route.useParams/useSearch/useNavigate`, `useQuery(['session', id])`, `useSessionStream(id)`, search schema `{ round?: string }` via zod. This is the file Phase 2 modifies.
- **Aliases:** `@/*` → `./src/*`. `cn` helper at `apps/web/src/lib/utils.ts`.
- **Existing UI primitives:** `badge`, `collapsible`, `separator`, `tabs` under `apps/web/src/components/ui/`. **No `tooltip`, no `dropdown-menu`.**
- **Test harness:** Vitest only; **no `@testing-library/react`/jsdom installed.** Existing tests are all pure-logic node tests (`use-locale-format.test.ts`, `compute-rounds.test.ts`, `step-helpers.test.ts`, `locale-parity.test.ts`). → TDD the pure logic only; verify components via typecheck + lint + dev server. Do NOT write component-render tests (the harness can't run them).

## Commands

- Run one test file: `pnpm --filter @argus/web exec vitest run src/lib/<file>.test.ts`
- Run all web tests: `pnpm --filter @argus/web test`
- Typecheck: `pnpm --filter @argus/web typecheck`
- Lint: `pnpm --filter @argus/web lint`
- Dev server: `pnpm --filter @argus/web dev` (open the printed localhost URL)

Every commit message ends with the trailer:

```
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

## File structure (created / modified)

**Phase 1 — application shell**

| File                                                          | Responsibility                                                                                     |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `apps/web/src/lib/sessions-select.ts` (+ `.test.ts`)          | Pure: `distinctProjects`, `filterSessionsByProject`, `adjacentSessions`, `listDurationLabel`.      |
| `apps/web/src/lib/theme.ts` (+ `.test.ts`)                    | Pure: `resolveInitialTheme(stored, prefersDark)`; `THEME_KEY`.                                     |
| `apps/web/src/lib/use-theme.ts`                               | Hook: applies/persists the `dark` class on `<html>`. Single source of truth (used only by Topbar). |
| `apps/web/src/lib/use-project-filter.ts`                      | Hook: read/write active project (`?project=` + localStorage).                                      |
| `apps/web/src/components/ui/dropdown-menu.tsx`                | Styled Radix dropdown-menu wrapper (new dep).                                                      |
| `apps/web/src/components/layout/nav-config.ts` (+ `.test.ts`) | Data: module nav (Sessions real; Monitoring/Analytics/Evals soon) + settings children.             |
| `apps/web/src/components/layout/NavItem.tsx`                  | One nav row: active / default / soon variants.                                                     |
| `apps/web/src/components/layout/OrgSwitcher.tsx`              | Current org (generic label) + reserved menu.                                                       |
| `apps/web/src/components/layout/ProjectSwitcher.tsx`          | Distinct-project dropdown; sets the filter.                                                        |
| `apps/web/src/components/layout/AccountMenu.tsx`              | Language + logout (replaces top-right `UserMenu`).                                                 |
| `apps/web/src/components/layout/Sidebar.tsx`                  | Assembles switchers + nav + settings + account.                                                    |
| `apps/web/src/components/layout/Topbar.tsx`                   | Auto breadcrumb + ⌘K placeholder + theme toggle.                                                   |
| `apps/web/src/components/layout/CommandPlaceholder.tsx`       | ⌘K dialog stub + key listener.                                                                     |
| `apps/web/src/components/layout/AppShell.tsx`                 | Grid: sidebar + topbar + content outlet.                                                           |
| `apps/web/src/routes/__root.tsx` (modify)                     | Gate: `loading` → spinner; `!user` → bare outlet; `user` → `AppShell`.                             |
| `apps/web/src/routes/sessions/index.tsx` (modify)             | Apply project filter; add Duration col; hide project col when filtered.                            |
| `apps/web/src/i18n/locales/{en,zh-CN,ja}.json` (modify)       | New shell strings (kept in parity).                                                                |

**Phase 2 — master-detail session detail**

| File                                                        | Responsibility                                                                                       |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `apps/web/src/components/layout/topbar-slot.tsx`            | Context + portal so a page can inject topbar actions.                                                |
| `apps/web/src/features/session-replay/rail/SessionRail.tsx` | Collapsible list of sessions in the current filter.                                                  |
| `apps/web/src/routes/sessions/$sessionId.tsx` (modify)      | Add rail column + inject prev/next into the topbar slot. **`SessionReplay` itself stays unchanged.** |

## Deliberate scope decisions (YAGNI)

- **No `DataTable` extraction.** No second table consumer exists yet (Monitoring/Analytics are Phase 3). Extracting now builds an abstraction for nothing. Keep the table inline.
- **No `cmdk` dependency.** ⌘K is a placeholder — a key listener + a "coming soon" dialog. Add `cmdk` in Phase 3.
- **No status column in the Sessions list** — `SessionSummary` lacks the field; fetching steps per row would be wasteful. Status stays in the detail view (already implemented there).
- **`SessionReplay` is not modified.** The spec's "session switching" is realized by the rail + prev/next added at the route level, honoring the spec promise that the replay panes are reused unchanged.
- **Phase 3 out of scope** (real `/projects` API, path-based scope, real ⌘K search, Monitoring/Analytics/Evals/Members pages — all need backend work not yet built).

---

## Task 1: Pure session-selection logic

**Files:**

- Create: `apps/web/src/lib/sessions-select.ts`
- Test: `apps/web/src/lib/sessions-select.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/sessions-select.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  distinctProjects,
  filterSessionsByProject,
  adjacentSessions,
  listDurationLabel,
} from './sessions-select'
import type { SessionSummary } from '@argus/shared-types'

function s(partial: Partial<SessionSummary>): SessionSummary {
  return {
    id: 'id',
    traceId: 'trace',
    projectName: 'p',
    serviceName: 'svc',
    startedAt: '2026-05-30T00:00:00.000Z',
    endedAt: null,
    stepCount: 0,
    ...partial,
  }
}

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

describe('filterSessionsByProject', () => {
  const list = [s({ id: 'a', projectName: 'alpha' }), s({ id: 'b', projectName: 'beta' })]
  it('returns all when project is null', () => {
    expect(filterSessionsByProject(list, null).map((x) => x.id)).toEqual(['a', 'b'])
  })
  it('filters by project name', () => {
    expect(filterSessionsByProject(list, 'beta').map((x) => x.id)).toEqual(['b'])
  })
})

describe('adjacentSessions', () => {
  const list = [s({ id: 'a' }), s({ id: 'b' }), s({ id: 'c' })]
  it('finds prev and next by id', () => {
    expect(adjacentSessions(list, 'b')).toEqual({ prev: list[0], next: list[2] })
  })
  it('returns null at the ends', () => {
    expect(adjacentSessions(list, 'a').prev).toBeNull()
    expect(adjacentSessions(list, 'c').next).toBeNull()
  })
  it('returns nulls when id missing', () => {
    expect(adjacentSessions(list, 'z')).toEqual({ prev: null, next: null })
  })
})

describe('listDurationLabel', () => {
  it('returns dash when endedAt is null', () => {
    expect(listDurationLabel(s({ endedAt: null }))).toBe('—')
  })
  it('formats sub-second as ms', () => {
    expect(
      listDurationLabel(
        s({ startedAt: '2026-05-30T00:00:00.000Z', endedAt: '2026-05-30T00:00:00.420Z' }),
      ),
    ).toBe('420ms')
  })
  it('formats seconds with one decimal', () => {
    expect(
      listDurationLabel(
        s({ startedAt: '2026-05-30T00:00:00.000Z', endedAt: '2026-05-30T00:00:01.234Z' }),
      ),
    ).toBe('1.2s')
  })
  it('formats minutes', () => {
    expect(
      listDurationLabel(
        s({ startedAt: '2026-05-30T00:00:00.000Z', endedAt: '2026-05-30T00:01:35.000Z' }),
      ),
    ).toBe('1m 35s')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @argus/web exec vitest run src/lib/sessions-select.test.ts`
Expected: FAIL — cannot find module `./sessions-select`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/lib/sessions-select.ts`:

```ts
import type { SessionSummary } from '@argus/shared-types'

export function distinctProjects(sessions: SessionSummary[]): string[] {
  return [...new Set(sessions.map((s) => s.projectName))].sort((a, b) => a.localeCompare(b))
}

export function filterSessionsByProject(
  sessions: SessionSummary[],
  project: string | null,
): SessionSummary[] {
  if (!project) return sessions
  return sessions.filter((s) => s.projectName === project)
}

export function adjacentSessions(
  sessions: SessionSummary[],
  currentId: string,
): { prev: SessionSummary | null; next: SessionSummary | null } {
  const i = sessions.findIndex((s) => s.id === currentId)
  if (i === -1) return { prev: null, next: null }
  return {
    prev: i > 0 ? sessions[i - 1] : null,
    next: i < sessions.length - 1 ? sessions[i + 1] : null,
  }
}

/** Duration label for a list row: dash when not ended, else ms / s / m+s. */
export function listDurationLabel(session: SessionSummary): string {
  if (!session.endedAt) return '—'
  const ms = new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime()
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60_000)
  const sec = Math.round((ms % 60_000) / 1000)
  return `${m}m ${sec}s`
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @argus/web exec vitest run src/lib/sessions-select.test.ts`
Expected: PASS (4 describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/sessions-select.ts apps/web/src/lib/sessions-select.test.ts
git commit -m "$(cat <<'EOF'
feat(web): pure session-selection helpers (filter/adjacent/duration)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Theme resolution logic + hook

**Files:**

- Create: `apps/web/src/lib/theme.ts`, `apps/web/src/lib/theme.test.ts`, `apps/web/src/lib/use-theme.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/theme.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolveInitialTheme } from './theme'

describe('resolveInitialTheme', () => {
  it('prefers a stored value', () => {
    expect(resolveInitialTheme('dark', false)).toBe('dark')
    expect(resolveInitialTheme('light', true)).toBe('light')
  })
  it('falls back to system preference when unstored', () => {
    expect(resolveInitialTheme(null, true)).toBe('dark')
    expect(resolveInitialTheme(null, false)).toBe('light')
  })
  it('ignores invalid stored values', () => {
    expect(resolveInitialTheme('purple', true)).toBe('dark')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @argus/web exec vitest run src/lib/theme.test.ts`
Expected: FAIL — cannot find module `./theme`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/lib/theme.ts`:

```ts
export type Theme = 'light' | 'dark'
export const THEME_KEY = 'argus.theme'

export function resolveInitialTheme(stored: string | null, prefersDark: boolean): Theme {
  if (stored === 'light' || stored === 'dark') return stored
  return prefersDark ? 'dark' : 'light'
}
```

Create `apps/web/src/lib/use-theme.ts`:

```ts
import { useEffect, useState } from 'react'
import { resolveInitialTheme, THEME_KEY, type Theme } from './theme'

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() =>
    resolveInitialTheme(
      typeof localStorage !== 'undefined' ? localStorage.getItem(THEME_KEY) : null,
      typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches,
    ),
  )

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  return { theme, toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @argus/web exec vitest run src/lib/theme.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/theme.ts apps/web/src/lib/theme.test.ts apps/web/src/lib/use-theme.ts
git commit -m "$(cat <<'EOF'
feat(web): theme resolution helper + use-theme hook

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Project-filter hook

**Files:**

- Create: `apps/web/src/lib/use-project-filter.ts`

Thin TanStack Router wrapper; verified through the Sessions list in Task 9. No unit test (it depends on router context).

- [ ] **Step 1: Write the implementation**

Create `apps/web/src/lib/use-project-filter.ts`:

```ts
import { useNavigate, useSearch } from '@tanstack/react-router'

const PROJECT_KEY = 'argus.project'

function readStored(): string | null {
  return typeof localStorage !== 'undefined' ? localStorage.getItem(PROJECT_KEY) : null
}

export function useProjectFilter() {
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as { project?: string }
  const project = search.project ?? readStored() ?? null

  function setProject(next: string | null) {
    if (next) localStorage.setItem(PROJECT_KEY, next)
    else localStorage.removeItem(PROJECT_KEY)
    void navigate({ to: '/sessions', search: next ? { project: next } : {} })
  }

  return { project, setProject }
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `pnpm --filter @argus/web typecheck`
Expected: PASS (compiles before any caller exists).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/use-project-filter.ts
git commit -m "$(cat <<'EOF'
feat(web): use-project-filter hook (?project + localStorage)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Radix dropdown-menu UI primitive

**Files:**

- Modify: `apps/web/package.json` (add dependency)
- Create: `apps/web/src/components/ui/dropdown-menu.tsx`

- [ ] **Step 1: Add the dependency**

Run: `pnpm --filter @argus/web add @radix-ui/react-dropdown-menu`
Expected: `@radix-ui/react-dropdown-menu` appears under `dependencies` in `apps/web/package.json`.

- [ ] **Step 2: Create the styled wrapper**

Create `apps/web/src/components/ui/dropdown-menu.tsx`:

```tsx
import * as React from 'react'
import * as Primitive from '@radix-ui/react-dropdown-menu'
import { cn } from '@/lib/utils'

export const DropdownMenu = Primitive.Root
export const DropdownMenuTrigger = Primitive.Trigger

export function DropdownMenuContent({
  className,
  align = 'start',
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'z-50 min-w-[12rem] rounded-md border border-hairline bg-popover py-1 u-body text-text-2 shadow-[var(--shadow-popover)]',
          className,
        )}
        {...props}
      />
    </Primitive.Portal>
  )
}

export function DropdownMenuItem({
  className,
  disabled,
  ...props
}: React.ComponentProps<typeof Primitive.Item>) {
  return (
    <Primitive.Item
      disabled={disabled}
      className={cn(
        'flex cursor-default items-center justify-between px-3 py-1.5 outline-none',
        disabled
          ? 'text-text-4'
          : 'text-text-2 data-[highlighted]:bg-tile data-[highlighted]:text-text-1',
        className,
      )}
      {...props}
    />
  )
}

export function DropdownMenuLabel({
  className,
  ...props
}: React.ComponentProps<typeof Primitive.Label>) {
  return (
    <Primitive.Label className={cn('px-3 pb-1 pt-1 u-caption text-text-3', className)} {...props} />
  )
}

export function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof Primitive.Separator>) {
  return <Primitive.Separator className={cn('my-1 h-px bg-hairline', className)} {...props} />
}
```

- [ ] **Step 3: Verify it typechecks**

Run: `pnpm --filter @argus/web typecheck`
Expected: PASS.

- [ ] **Step 4: Commit** (run `git add` from the repo root so the lockfile path resolves)

```bash
cd /Users/fooevr/Code/argus
git add apps/web/package.json apps/web/src/components/ui/dropdown-menu.tsx pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat(web): styled Radix dropdown-menu primitive

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Navigation config (data-driven)

**Files:**

- Create: `apps/web/src/components/layout/nav-config.ts`, `apps/web/src/components/layout/nav-config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/components/layout/nav-config.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { MODULE_NAV, SETTINGS_NAV } from './nav-config'

describe('nav config', () => {
  it('only Sessions is enabled among modules', () => {
    expect(MODULE_NAV.filter((n) => !n.soon).map((n) => n.key)).toEqual(['sessions'])
  })
  it('marks monitoring, analytics, evals as soon', () => {
    expect(MODULE_NAV.filter((n) => n.soon).map((n) => n.key)).toEqual([
      'monitoring',
      'analytics',
      'evals',
    ])
  })
  it('only Tokens is enabled among settings children', () => {
    expect(SETTINGS_NAV.filter((n) => !n.soon).map((n) => n.key)).toEqual(['tokens'])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @argus/web exec vitest run src/components/layout/nav-config.test.ts`
Expected: FAIL — cannot find module `./nav-config`.

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/components/layout/nav-config.ts`:

```ts
import {
  Activity,
  BarChart3,
  FlaskConical,
  KeyRound,
  ListTree,
  Plug,
  Settings,
  Users,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export interface NavEntry {
  key: string
  /** i18n key for the label */
  labelKey: string
  icon: LucideIcon
  /** route path; undefined when soon */
  to?: string
  soon?: boolean
}

export const MODULE_NAV: NavEntry[] = [
  { key: 'sessions', labelKey: 'shell.modules.sessions', icon: ListTree, to: '/sessions' },
  { key: 'monitoring', labelKey: 'shell.modules.monitoring', icon: Activity, soon: true },
  { key: 'analytics', labelKey: 'shell.modules.analytics', icon: BarChart3, soon: true },
  { key: 'evals', labelKey: 'shell.modules.evals', icon: FlaskConical, soon: true },
]

export const SETTINGS_NAV: NavEntry[] = [
  { key: 'tokens', labelKey: 'shell.settingsNav.tokens', icon: KeyRound, to: '/settings/tokens' },
  { key: 'members', labelKey: 'shell.settingsNav.members', icon: Users, soon: true },
  { key: 'general', labelKey: 'shell.settingsNav.general', icon: Settings, soon: true },
  { key: 'integrations', labelKey: 'shell.settingsNav.integrations', icon: Plug, soon: true },
]
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @argus/web exec vitest run src/components/layout/nav-config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/layout/nav-config.ts apps/web/src/components/layout/nav-config.test.ts
git commit -m "$(cat <<'EOF'
feat(web): data-driven sidebar nav config (modules + settings)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: i18n strings for the shell

**Files:**

- Modify: `apps/web/src/i18n/locales/en.json`, `zh-CN.json`, `ja.json`

Merge the new keys into the **existing** `shell` object (keep `shell.nav`, `shell.auth`, `shell.language`, `shell.verifyNag`). The parity test requires identical key sets across all three files — add to all three in this one commit.

- [ ] **Step 1: Add keys to `en.json`** — inside the existing `shell` object, add:

```json
"org": { "workspace": "Workspace", "manageTeams": "Manage teams" },
"project": { "all": "All projects" },
"sectionObserve": "Observe",
"settingsHeading": "Settings",
"soon": "soon",
"soonHint": "Coming soon",
"theme": { "toggle": "Toggle theme" },
"search": { "open": "Search", "placeholder": "Search…", "comingSoon": "Global search is coming soon." },
"modules": {
  "sessions": "Sessions",
  "monitoring": "Monitoring",
  "analytics": "Analytics",
  "evals": "Evals"
},
"settingsNav": {
  "tokens": "Tokens",
  "members": "Members",
  "general": "General",
  "integrations": "Integrations"
}
```

- [ ] **Step 2: Add the same keys to `zh-CN.json`** (inside its `shell` object):

```json
"org": { "workspace": "工作区", "manageTeams": "管理团队" },
"project": { "all": "全部项目" },
"sectionObserve": "观测",
"settingsHeading": "设置",
"soon": "即将",
"soonHint": "即将上线",
"theme": { "toggle": "切换主题" },
"search": { "open": "搜索", "placeholder": "搜索…", "comingSoon": "全局搜索即将上线。" },
"modules": {
  "sessions": "会话",
  "monitoring": "监控",
  "analytics": "分析",
  "evals": "评估"
},
"settingsNav": {
  "tokens": "令牌",
  "members": "成员",
  "general": "通用",
  "integrations": "集成"
}
```

- [ ] **Step 3: Add the same keys to `ja.json`** (inside its `shell` object):

```json
"org": { "workspace": "ワークスペース", "manageTeams": "チームを管理" },
"project": { "all": "すべてのプロジェクト" },
"sectionObserve": "観測",
"settingsHeading": "設定",
"soon": "近日",
"soonHint": "近日公開",
"theme": { "toggle": "テーマを切り替え" },
"search": { "open": "検索", "placeholder": "検索…", "comingSoon": "グローバル検索は近日公開予定です。" },
"modules": {
  "sessions": "セッション",
  "monitoring": "モニタリング",
  "analytics": "分析",
  "evals": "評価"
},
"settingsNav": {
  "tokens": "トークン",
  "members": "メンバー",
  "general": "一般",
  "integrations": "連携"
}
```

- [ ] **Step 4: Verify parity passes**

Run: `pnpm --filter @argus/web exec vitest run src/i18n/locale-parity.test.ts`
Expected: PASS (both `zh-CN` and `ja` match the en key set). If it fails, the diff in the error shows the missing/extra key — fix and re-run.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/i18n/locales/en.json apps/web/src/i18n/locales/zh-CN.json apps/web/src/i18n/locales/ja.json
git commit -m "$(cat <<'EOF'
feat(web): i18n strings for the app shell (en/zh-CN/ja)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: NavItem component

**Files:**

- Create: `apps/web/src/components/layout/NavItem.tsx`

- [ ] **Step 1: Write the implementation**

Create `apps/web/src/components/layout/NavItem.tsx`:

```tsx
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import type { NavEntry } from './nav-config'
import { cn } from '@/lib/utils'

export function NavItem({ entry, active }: { entry: NavEntry; active?: boolean }) {
  const { t } = useTranslation()
  const Icon = entry.icon
  const label = t(entry.labelKey)

  if (entry.soon || !entry.to) {
    return (
      <div
        title={t('shell.soonHint')}
        className="flex cursor-default items-center gap-2 rounded px-2 py-1.5 u-body text-text-4"
      >
        <Icon className="size-4 shrink-0" />
        <span className="truncate">{label}</span>
        <span className="ml-auto rounded-pill bg-tile px-1.5 py-0.5 u-caption text-text-3">
          {t('shell.soon')}
        </span>
      </div>
    )
  }

  return (
    <Link
      to={entry.to}
      className={cn(
        'relative flex items-center gap-2 rounded px-2 py-1.5 u-body transition-colors',
        active
          ? 'bg-tint-brand text-brand before:absolute before:left-0 before:top-1 before:bottom-1 before:w-0.5 before:rounded-pill before:bg-brand'
          : 'text-text-2 hover:bg-tile hover:text-text-1',
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span className="truncate">{label}</span>
    </Link>
  )
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `pnpm --filter @argus/web typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/layout/NavItem.tsx
git commit -m "$(cat <<'EOF'
feat(web): NavItem (active / default / soon variants)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Switchers + account menu

**Files:**

- Create: `apps/web/src/components/layout/OrgSwitcher.tsx`, `ProjectSwitcher.tsx`, `AccountMenu.tsx`

- [ ] **Step 1: Create `OrgSwitcher.tsx`**

```tsx
import { ChevronsUpDown, Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/lib/auth-provider'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'

export function OrgSwitcher() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const label = t('shell.org.workspace')

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex w-full items-center gap-2 rounded border border-hairline px-2 py-1.5 u-body text-text-1 hover:bg-tile"
        title={user?.orgId}
      >
        <span className="truncate">{label}</span>
        <ChevronsUpDown className="ml-auto size-3.5 text-text-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]">
        <DropdownMenuItem>
          <span>{label}</span>
          <Check className="size-3.5 text-brand" />
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>{t('shell.org.manageTeams')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
```

- [ ] **Step 2: Create `ProjectSwitcher.tsx`**

```tsx
import { ChevronsUpDown, Check } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { fetchSessions } from '@/lib/api'
import { distinctProjects } from '@/lib/sessions-select'
import { useProjectFilter } from '@/lib/use-project-filter'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'

export function ProjectSwitcher() {
  const { t } = useTranslation()
  const { project, setProject } = useProjectFilter()
  const { data } = useQuery({ queryKey: ['sessions'], queryFn: fetchSessions, retry: false })
  const projects = data ? distinctProjects(data.sessions) : []
  const current = project ?? t('shell.project.all')

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
          <DropdownMenuItem key={p} onSelect={() => setProject(p)}>
            <span className="truncate">{p}</span>
            {project === p && <Check className="size-3.5 text-brand" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
```

- [ ] **Step 3: Create `AccountMenu.tsx`** (language + logout; theme lives in the topbar)

```tsx
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ChevronsUpDown, Check } from 'lucide-react'
import i18n, { LOCALE_LABELS, SUPPORTED_LOCALES, type SupportedLocale } from '@/i18n'
import { useAuth } from '@/lib/auth-provider'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'

export function AccountMenu() {
  const { t, i18n: i18nInstance } = useTranslation()
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const current = i18nInstance.resolvedLanguage as SupportedLocale | undefined

  async function handleLogout() {
    await logout()
    void navigate({ to: '/login' })
  }

  if (!user) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded px-2 py-1.5 u-body text-text-2 hover:bg-tile">
        <span className="truncate">{user.email}</span>
        <ChevronsUpDown className="ml-auto size-3.5 text-text-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" side="top">
        <DropdownMenuLabel>{t('shell.language')}</DropdownMenuLabel>
        {SUPPORTED_LOCALES.map((code) => (
          <DropdownMenuItem
            key={code}
            onSelect={(e) => {
              e.preventDefault()
              void i18n.changeLanguage(code)
            }}
          >
            <span>{LOCALE_LABELS[code]}</span>
            {current === code && <Check className="size-3.5 text-brand" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={handleLogout}>{t('shell.auth.signOut')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
```

> Note: `@/i18n` resolves to `src/i18n/index.ts` (the barrel). Confirmed export names: `SUPPORTED_LOCALES`, `LOCALE_LABELS`, `SupportedLocale`, default `i18n`.

- [ ] **Step 4: Verify it typechecks**

Run: `pnpm --filter @argus/web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/layout/OrgSwitcher.tsx apps/web/src/components/layout/ProjectSwitcher.tsx apps/web/src/components/layout/AccountMenu.tsx
git commit -m "$(cat <<'EOF'
feat(web): sidebar switchers + account menu

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Sidebar, Topbar, CommandPlaceholder, AppShell

**Files:**

- Create: `apps/web/src/components/layout/Sidebar.tsx`, `CommandPlaceholder.tsx`, `Topbar.tsx`, `AppShell.tsx`

- [ ] **Step 1: Create `Sidebar.tsx`**

```tsx
import { Link, useRouterState } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { MODULE_NAV, SETTINGS_NAV } from './nav-config'
import { NavItem } from './NavItem'
import { OrgSwitcher } from './OrgSwitcher'
import { ProjectSwitcher } from './ProjectSwitcher'
import { AccountMenu } from './AccountMenu'

export function Sidebar() {
  const { t } = useTranslation()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const isActive = (to?: string) => !!to && (pathname === to || pathname.startsWith(to + '/'))

  return (
    <aside className="flex h-full w-60 flex-col border-r border-hairline bg-sidebar">
      <div className="flex items-center px-4 py-3">
        <Link to="/" className="u-h-lg tracking-tight text-text-1">
          Argus
        </Link>
      </div>

      <div className="space-y-2 px-3">
        <OrgSwitcher />
        <ProjectSwitcher />
      </div>

      <nav className="mt-4 flex-1 space-y-0.5 overflow-y-auto px-3">
        <div className="px-2 pb-1 pt-2 u-h-sm text-text-3">{t('shell.sectionObserve')}</div>
        {MODULE_NAV.map((entry) => (
          <NavItem key={entry.key} entry={entry} active={isActive(entry.to)} />
        ))}

        <div className="my-2 h-px bg-hairline" />
        <div className="px-2 pb-1 pt-2 u-h-sm text-text-3">{t('shell.settingsHeading')}</div>
        {SETTINGS_NAV.map((entry) => (
          <NavItem key={entry.key} entry={entry} active={isActive(entry.to)} />
        ))}
      </nav>

      <div className="border-t border-hairline px-3 py-2">
        <AccountMenu />
      </div>
    </aside>
  )
}
```

- [ ] **Step 2: Create `CommandPlaceholder.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function CommandPlaceholder() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('shell.search.open')}
        className="flex h-8 items-center gap-2 rounded border border-hairline px-2.5 u-caption text-text-3 hover:bg-tile"
      >
        <Search className="size-3.5" />
        <span className="hidden sm:inline">{t('shell.search.placeholder')}</span>
        <span className="ml-2 hidden rounded bg-tile px-1 py-0.5 u-caption text-text-4 sm:inline">
          ⌘K
        </span>
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 pt-32"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-[32rem] max-w-[90vw] rounded-md border border-hairline bg-popover p-4 shadow-[var(--shadow-dialog)]"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="u-body text-text-2">{t('shell.search.comingSoon')}</p>
          </div>
        </div>
      )}
    </>
  )
}
```

- [ ] **Step 3: Create `Topbar.tsx`** (breadcrumb + ⌘K + theme; sole `useTheme` caller)

```tsx
import { useRouterState } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Moon, Sun } from 'lucide-react'
import { MODULE_NAV, SETTINGS_NAV } from './nav-config'
import { CommandPlaceholder } from './CommandPlaceholder'
import { useTheme } from '@/lib/use-theme'

function useBreadcrumb(): string {
  const { t } = useTranslation()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const all = [...MODULE_NAV, ...SETTINGS_NAV]
  const match = all.find((n) => n.to && (pathname === n.to || pathname.startsWith(n.to + '/')))
  return match ? t(match.labelKey) : ''
}

export function Topbar() {
  const { t } = useTranslation()
  const crumb = useBreadcrumb()
  const { theme, toggle } = useTheme()

  return (
    <header className="flex h-11 shrink-0 items-center gap-3 border-b border-hairline px-4">
      <div className="u-h-md text-text-1">{crumb}</div>
      <div className="ml-auto flex items-center gap-2">
        <CommandPlaceholder />
        <button
          type="button"
          onClick={toggle}
          aria-label={t('shell.theme.toggle')}
          className="flex size-8 items-center justify-center rounded border border-hairline text-text-3 hover:bg-tile"
        >
          {theme === 'dark' ? <Moon className="size-4" /> : <Sun className="size-4" />}
        </button>
      </div>
    </header>
  )
}
```

- [ ] **Step 4: Create `AppShell.tsx`**

```tsx
import type { ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { VerifyNagBar } from '@/features/email-verify-nag/VerifyNagBar'

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="grid h-screen grid-cols-[auto_1fr] bg-page text-text-2">
      <Sidebar />
      <div className="grid grid-rows-[auto_auto_1fr] overflow-hidden">
        <Topbar />
        <VerifyNagBar />
        <main className="overflow-hidden">{children}</main>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Verify it typechecks**

Run: `pnpm --filter @argus/web typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/layout/Sidebar.tsx apps/web/src/components/layout/CommandPlaceholder.tsx apps/web/src/components/layout/Topbar.tsx apps/web/src/components/layout/AppShell.tsx
git commit -m "$(cat <<'EOF'
feat(web): Sidebar, Topbar, ⌘K placeholder, AppShell

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Wire AppShell into the root route

**Files:**

- Modify: `apps/web/src/routes/__root.tsx`

- [ ] **Step 1: Rewrite `__root.tsx`** (replace the entire file)

```tsx
import { createRootRoute, Outlet } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { AuthProvider, useAuth } from '../lib/auth-provider'
import { AppShell } from '../components/layout/AppShell'

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  )
}

function Shell() {
  const { t } = useTranslation()
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center u-body text-text-3">
        {t('common.loading')}
      </div>
    )
  }

  if (!user) {
    return (
      <div className="h-screen bg-page text-text-2">
        <Outlet />
      </div>
    )
  }

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  )
}
```

- [ ] **Step 2: Verify it typechecks and lints**

Run: `pnpm --filter @argus/web typecheck && pnpm --filter @argus/web lint`
Expected: PASS. The old `UserMenu`/`SignInLink`/`Link`/`useNavigate`/`useState`/locale imports are gone — confirm no unused-import lint errors remain.

- [ ] **Step 3: Visual verification**

Run: `pnpm --filter @argus/web dev`, open the URL while logged in.
Expected: left sidebar with "Argus", Workspace + project switchers, "Observe" section (Sessions active; Monitoring/Analytics/Evals grayed + "soon"), "Settings" section (Tokens active; others grayed), account menu pinned at the bottom; thin topbar with breadcrumb + ⌘K + theme toggle. Toggle theme → whole app flips and persists on reload. Press ⌘K → "coming soon" panel. Visit `/login` logged out → no shell, just the centered form.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/__root.tsx
git commit -m "$(cat <<'EOF'
feat(web): mount AppShell from the root route with auth gating

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Sessions list — project filter + Duration column

**Files:**

- Modify: `apps/web/src/routes/sessions/index.tsx`
- Modify: `apps/web/src/i18n/locales/{en,zh-CN,ja}.json` (Duration column label)

- [ ] **Step 1: Add the `duration` column label** to `sessions.list.columns` in all three locale files (keep existing `project, service, trace, steps, started`):
- en: `"duration": "Duration"`
- zh-CN: `"duration": "时长"`
- ja: `"duration": "実行時間"`

Run parity check: `pnpm --filter @argus/web exec vitest run src/i18n/locale-parity.test.ts` → PASS.

- [ ] **Step 2: Add route search validation.** Replace the `createFileRoute` call at the top of `apps/web/src/routes/sessions/index.tsx`:

```tsx
export const Route = createFileRoute('/sessions/')({
  validateSearch: (search: Record<string, unknown>): { project?: string } => ({
    project: typeof search.project === 'string' ? search.project : undefined,
  }),
  component: SessionsList,
})
```

- [ ] **Step 3: Add imports** near the existing imports:

```tsx
import { useProjectFilter } from '../../lib/use-project-filter'
import { filterSessionsByProject, listDurationLabel } from '../../lib/sessions-select'
```

- [ ] **Step 4: Derive filtered rows** inside `SessionsList`, right after the `useQuery(...)` call:

```tsx
const { project } = useProjectFilter()
const rows = data ? filterSessionsByProject(data.sessions, project) : []
```

- [ ] **Step 5: Replace the success-branch table** (the final `return (<div className="p-6 overflow-auto h-full">…)`). Hide the Project column when filtered; add Duration:

```tsx
return (
  <div className="p-6 overflow-auto h-full">
    <h2 className="u-h-lg text-text-1 mb-3">{t('sessions.list.title')}</h2>
    <div className="border border-hairline rounded">
      <table className="w-full u-body">
        <thead>
          <tr className="text-left u-caption text-text-3 border-b border-hairline">
            {!project && (
              <th className="font-normal px-3 py-2">{t('sessions.list.columns.project')}</th>
            )}
            <th className="font-normal px-3 py-2">{t('sessions.list.columns.service')}</th>
            <th className="font-normal px-3 py-2">{t('sessions.list.columns.trace')}</th>
            <th className="font-normal px-3 py-2">{t('sessions.list.columns.steps')}</th>
            <th className="font-normal px-3 py-2">{t('sessions.list.columns.duration')}</th>
            <th className="font-normal px-3 py-2">{t('sessions.list.columns.started')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr
              key={s.id}
              className="border-b border-hairline last:border-0 hover:bg-tile transition-colors"
            >
              {!project && <td className="px-3 py-2 text-text-1">{s.projectName}</td>}
              <td className="px-3 py-2 text-text-2">{s.serviceName}</td>
              <td className="px-3 py-2">
                <Link
                  to="/sessions/$sessionId"
                  params={{ sessionId: s.id }}
                  className="font-mono text-[11px] text-brand hover:text-brand-hover tabular"
                >
                  {s.traceId.slice(0, 16)}…
                </Link>
              </td>
              <td className="px-3 py-2 text-text-2 tabular">{s.stepCount}</td>
              <td className="px-3 py-2 text-text-3 tabular">{listDurationLabel(s)}</td>
              <td className="px-3 py-2 text-text-3 tabular">{f.dateTime(new Date(s.startedAt))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
)
```

- [ ] **Step 6: Verify it typechecks and lints**

Run: `pnpm --filter @argus/web typecheck && pnpm --filter @argus/web lint`
Expected: PASS.

- [ ] **Step 7: Visual verification**

Dev server + seeded sessions: list shows Project / Service / Trace / Steps / Duration / Started. Open the sidebar project switcher, pick a project → URL gets `?project=<name>`, list filters, Project column disappears. Pick "All projects" → filter clears.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/routes/sessions/index.tsx apps/web/src/i18n/locales/en.json apps/web/src/i18n/locales/zh-CN.json apps/web/src/i18n/locales/ja.json
git commit -m "$(cat <<'EOF'
feat(web): sessions list project filter + duration column

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Topbar action slot (context + portal)

**Files:**

- Create: `apps/web/src/components/layout/topbar-slot.tsx`
- Modify: `apps/web/src/components/layout/Topbar.tsx`, `AppShell.tsx`

Phase 2 begins. The detail route needs to inject prev/next into the global topbar. A context-held target node + a portal is the interface; pages call `<TopbarActions>`.

- [ ] **Step 1: Create `topbar-slot.tsx`**

```tsx
import { createContext, useContext, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface SlotValue {
  target: HTMLElement | null
  setTarget: (el: HTMLElement | null) => void
}

const SlotContext = createContext<SlotValue | null>(null)

export function TopbarSlotProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null)
  return <SlotContext.Provider value={{ target, setTarget }}>{children}</SlotContext.Provider>
}

/** Rendered once inside the Topbar; registers its DOM node as the portal target. */
export function TopbarSlotTarget() {
  const ctx = useContext(SlotContext)
  return <div ref={(node) => ctx?.setTarget(node)} className="flex items-center gap-2" />
}

/** Render children into the topbar's action area from any page. */
export function TopbarActions({ children }: { children: ReactNode }) {
  const ctx = useContext(SlotContext)
  if (!ctx?.target) return null
  return createPortal(children, ctx.target)
}
```

- [ ] **Step 2: Render the target in `Topbar.tsx`** — add the import and place `<TopbarSlotTarget />` first in the action row:

```tsx
import { TopbarSlotTarget } from './topbar-slot'
```

```tsx
<div className="ml-auto flex items-center gap-2">
  <TopbarSlotTarget />
  <CommandPlaceholder />
  <button
    type="button"
    onClick={toggle}
    aria-label={t('shell.theme.toggle')}
    className="flex size-8 items-center justify-center rounded border border-hairline text-text-3 hover:bg-tile"
  >
    {theme === 'dark' ? <Moon className="size-4" /> : <Sun className="size-4" />}
  </button>
</div>
```

- [ ] **Step 3: Wrap content in the provider in `AppShell.tsx`**

```tsx
import { TopbarSlotProvider } from './topbar-slot'
```

```tsx
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="grid h-screen grid-cols-[auto_1fr] bg-page text-text-2">
      <Sidebar />
      <TopbarSlotProvider>
        <div className="grid grid-rows-[auto_auto_1fr] overflow-hidden">
          <Topbar />
          <VerifyNagBar />
          <main className="overflow-hidden">{children}</main>
        </div>
      </TopbarSlotProvider>
    </div>
  )
}
```

- [ ] **Step 4: Verify it typechecks**

Run: `pnpm --filter @argus/web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/layout/topbar-slot.tsx apps/web/src/components/layout/Topbar.tsx apps/web/src/components/layout/AppShell.tsx
git commit -m "$(cat <<'EOF'
feat(web): topbar action slot for page-injected controls

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Session rail (collapsible master list)

**Files:**

- Create: `apps/web/src/features/session-replay/rail/SessionRail.tsx`
- Modify: `apps/web/src/i18n/locales/{en,zh-CN,ja}.json` (rail labels under a new top-level `rail` namespace)

- [ ] **Step 1: Add rail i18n keys** as a new top-level object in each locale (alongside `common`, `shell`, …):
- en: `"rail": { "expand": "Show sessions", "collapse": "Hide sessions", "title": "Sessions" }`
- zh-CN: `"rail": { "expand": "显示会话", "collapse": "隐藏会话", "title": "会话" }`
- ja: `"rail": { "expand": "セッションを表示", "collapse": "セッションを非表示", "title": "セッション" }`

Run parity check: `pnpm --filter @argus/web exec vitest run src/i18n/locale-parity.test.ts` → PASS.

- [ ] **Step 2: Create `SessionRail.tsx`**

```tsx
import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { PanelLeftOpen, PanelLeftClose } from 'lucide-react'
import { fetchSessions } from '@/lib/api'
import { filterSessionsByProject } from '@/lib/sessions-select'
import { useProjectFilter } from '@/lib/use-project-filter'
import { cn } from '@/lib/utils'

export function SessionRail({ activeSessionId }: { activeSessionId: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { project } = useProjectFilter()
  const { data } = useQuery({ queryKey: ['sessions'], queryFn: fetchSessions, retry: false })
  const rows = data ? filterSessionsByProject(data.sessions, project) : []

  if (!open) {
    return (
      <div className="flex w-10 flex-col items-center border-r border-hairline bg-sidebar py-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t('rail.expand')}
          className="flex size-8 items-center justify-center rounded text-text-3 hover:bg-tile"
        >
          <PanelLeftOpen className="size-4" />
        </button>
      </div>
    )
  }

  return (
    <div className="flex w-64 flex-col border-r border-hairline bg-sidebar">
      <div className="flex items-center gap-2 border-b border-hairline px-3 py-2">
        <span className="u-h-sm text-text-3">{t('rail.title')}</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label={t('rail.collapse')}
          className="ml-auto flex size-7 items-center justify-center rounded text-text-3 hover:bg-tile"
        >
          <PanelLeftClose className="size-4" />
        </button>
      </div>
      <nav className="flex-1 overflow-y-auto p-1">
        {rows.map((s) => (
          <Link
            key={s.id}
            to="/sessions/$sessionId"
            params={{ sessionId: s.id }}
            className={cn(
              'block rounded px-2 py-1.5',
              s.id === activeSessionId ? 'bg-tint-brand text-brand' : 'text-text-2 hover:bg-tile',
            )}
          >
            <div className="truncate u-body">{s.serviceName}</div>
            <div className="truncate u-caption text-text-3 tabular">{s.traceId.slice(0, 12)}…</div>
          </Link>
        ))}
      </nav>
    </div>
  )
}
```

- [ ] **Step 3: Verify it typechecks**

Run: `pnpm --filter @argus/web typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/session-replay/rail/SessionRail.tsx apps/web/src/i18n/locales/en.json apps/web/src/i18n/locales/zh-CN.json apps/web/src/i18n/locales/ja.json
git commit -m "$(cat <<'EOF'
feat(web): collapsible session rail (master list)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Wire rail + prev/next into the detail route

**Files:**

- Modify: `apps/web/src/routes/sessions/$sessionId.tsx`
- Modify: `apps/web/src/i18n/locales/{en,zh-CN,ja}.json` (prev/next labels under the `rail` namespace)

The rail wraps `SessionReplay` at the **route** level; `SessionReplay` itself is untouched. Prev/next are injected into the topbar slot.

- [ ] **Step 1: Add prev/next i18n keys** into the existing `rail` namespace in all three locales:
- en: `"prev": "Previous session", "next": "Next session"`
- zh-CN: `"prev": "上一个会话", "next": "下一个会话"`
- ja: `"prev": "前のセッション", "next": "次のセッション"`

Run parity check: `pnpm --filter @argus/web exec vitest run src/i18n/locale-parity.test.ts` → PASS.

- [ ] **Step 2: Rewrite `routes/sessions/$sessionId.tsx`** (replace the whole file)

```tsx
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { fetchSession, fetchSessions } from '../../lib/api'
import { useSessionStream } from '../../lib/use-session-stream'
import { adjacentSessions, filterSessionsByProject } from '../../lib/sessions-select'
import { useProjectFilter } from '../../lib/use-project-filter'
import { SessionReplay } from '../../features/session-replay'
import { SessionRail } from '../../features/session-replay/rail/SessionRail'
import { TopbarActions } from '../../components/layout/topbar-slot'

const searchSchema = z.object({
  round: z.string().optional(),
})

export const Route = createFileRoute('/sessions/$sessionId')({
  validateSearch: searchSchema,
  component: SessionDetail,
})

function navBtn(enabled: boolean) {
  return enabled
    ? 'flex size-8 items-center justify-center rounded border border-hairline text-text-3 hover:bg-tile'
    : 'flex size-8 items-center justify-center rounded border border-hairline text-text-4'
}

function SessionDetail() {
  const { t } = useTranslation()
  const { sessionId } = Route.useParams()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const { project } = useProjectFilter()

  const { data, isLoading, error } = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => fetchSession(sessionId),
  })
  const { data: list } = useQuery({ queryKey: ['sessions'], queryFn: fetchSessions, retry: false })
  const stream = useSessionStream(sessionId)

  const siblings = list ? filterSessionsByProject(list.sessions, project) : []
  const { prev, next } = adjacentSessions(siblings, sessionId)

  if (isLoading) return <div className="p-6 u-body text-text-3">{t('common.loading')}</div>
  if (error)
    return (
      <div className="p-6 u-body text-danger">{t('common.error', { message: String(error) })}</div>
    )
  if (!data) return <div className="p-6 u-body text-text-2">{t('common.notFound')}</div>

  return (
    <div className="grid h-full grid-cols-[auto_1fr] overflow-hidden">
      <SessionRail activeSessionId={sessionId} />
      <div className="overflow-hidden">
        <TopbarActions>
          {prev ? (
            <Link
              to="/sessions/$sessionId"
              params={{ sessionId: prev.id }}
              aria-label={t('rail.prev')}
              className={navBtn(true)}
            >
              <ChevronLeft className="size-4" />
            </Link>
          ) : (
            <span aria-label={t('rail.prev')} className={navBtn(false)}>
              <ChevronLeft className="size-4" />
            </span>
          )}
          {next ? (
            <Link
              to="/sessions/$sessionId"
              params={{ sessionId: next.id }}
              aria-label={t('rail.next')}
              className={navBtn(true)}
            >
              <ChevronRight className="size-4" />
            </Link>
          ) : (
            <span aria-label={t('rail.next')} className={navBtn(false)}>
              <ChevronRight className="size-4" />
            </span>
          )}
        </TopbarActions>

        <SessionReplay
          session={data.session}
          steps={data.steps}
          activeRoundId={search.round}
          connected={stream.connected}
          onSelectRound={(round) => navigate({ search: { round }, replace: true })}
        />
      </div>
    </div>
  )
}
```

> Note: `SessionReplay` is passed exactly the same props as before; only the surrounding markup (rail column + topbar actions) is new. The inner `h-full flex flex-col` of `SessionReplay` fills the right column.

- [ ] **Step 3: Verify it typechecks and lints**

Run: `pnpm --filter @argus/web typecheck && pnpm --filter @argus/web lint`
Expected: PASS.

- [ ] **Step 4: Visual verification**

Dev server, open a session detail page:

- A collapsed rail icon sits at the far left; clicking expands a session list; clicking another session navigates to it and highlights it.
- The global topbar shows ◀ ▶; they navigate prev/next within the current filter and are grayed at the ends.
- The existing `SessionReplay` (its own topbar + timeline + detail) renders exactly as before.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/sessions/$sessionId.tsx apps/web/src/i18n/locales/en.json apps/web/src/i18n/locales/zh-CN.json apps/web/src/i18n/locales/ja.json
git commit -m "$(cat <<'EOF'
feat(web): session detail master-detail rail + prev/next

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final verification

- [ ] **All web tests pass:** `pnpm --filter @argus/web test` → PASS (sessions-select, theme, nav-config, locale-parity, plus the pre-existing tests).
- [ ] **Typecheck clean:** `pnpm --filter @argus/web typecheck`.
- [ ] **Lint clean:** `pnpm --filter @argus/web lint` (no orphaned imports from the `__root.tsx` rewrite).
- [ ] **Build:** `pnpm --filter @argus/web build` → succeeds.
- [ ] **Manual smoke (dev server):** login → sidebar shell renders; project switcher filters the list and hides the project column; soon items are grayed and non-navigable; theme toggle flips light/dark and persists across reload; ⌘K opens the coming-soon panel; session detail shows rail + prev/next and the replay panes are unchanged; logged-out `/login` shows no shell.

---

## Self-review (completed by plan author)

- **Spec coverage:** App shell (T9/T10) ✓; three-scope IA — org switcher (T8), project switcher (T3/T8), session scope (T13/T14) ✓; sidebar with Sessions active + Monitoring/Analytics/Evals soon + Settings children soon (T5/T7/T9) ✓; account menu moved to sidebar bottom (T8/T9) ✓; thin topbar with breadcrumb + theme + ⌘K placeholder (T9) ✓; auth pages outside the shell (T10) ✓; project filter via `?project=`+localStorage (T3) ✓; sessions list columns (T11) ✓; master-detail rail default-collapsed + prev/next + topbar injection (T12/T13/T14) ✓; i18n en/zh-CN/ja with parity (T6/T11/T13/T14) ✓.
- **Spec deviations (intentional, documented):** No status column in the list (`SessionSummary` has no status field — status remains in the detail view via existing helpers). OrgSwitcher uses a generic "Workspace" label (no org name in the API). `DataTable` extraction and `cmdk` deferred (YAGNI). The spec's topbar "session dropdown" is realized as the expandable rail + prev/next; a separate dropdown is redundant and omitted. `SessionReplay` is wrapped at the route, not modified — honoring "replay panes reused unchanged".
- **Type consistency:** `useProjectFilter()` → `{ project: string|null, setProject }` used identically in T8/T11/T13/T14; `adjacentSessions` → `{ prev, next }` in T14; `NavEntry` shape consistent across T5/T7/T9; `listDurationLabel(SessionSummary)` signature matches its only caller in T11; `SessionReplay` props in T14 match its current signature exactly (`session, steps, activeRoundId, connected, onSelectRound`); i18n keys referenced in components (`shell.modules.*`, `shell.settingsNav.*`, `shell.project.all`, `shell.org.*`, `shell.search.*`, `shell.theme.toggle`, `shell.sectionObserve`, `shell.settingsHeading`, `shell.soon`, `shell.soonHint`, `rail.*`, `sessions.list.columns.duration`) are all defined in T6/T11/T13/T14.
- **Placeholder scan:** none — every code step has complete code; ⌘K and soon modules are intentional product placeholders, not plan gaps.
- **Harness note:** all `*.test.ts` are pure-logic (node) — runnable by the existing Vitest config. No component-render tests (no jsdom/@testing-library installed).
