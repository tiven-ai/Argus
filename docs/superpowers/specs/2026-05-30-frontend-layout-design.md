# Argus Frontend Layout & Information Architecture

**Date:** 2026-05-30
**Status:** Approved design (brainstorming output)
**Scope:** Application shell, navigation, and information architecture for the Argus web frontend, designed against the full product roadmap.

## Problem

The current web frontend is structurally thin: a single top navigation bar with two links ("Sessions", "Tokens"), no sidebar, no project switcher, no organization context, and no place for the roadmap's future modules (monitoring, analytics, evals, team management). The session detail page is mature (the M3+ round-based two-pane replay), but everything around it is a placeholder shell.

This spec defines a navigation and layout structure that:

1. Matches the conventions of comparable AI-observability tools (left sidebar + thin topbar + content area).
2. Surfaces the three scopes implied by the data model: **organization → project → session**.
3. Leaves clearly-marked room for roadmap modules without building empty pages.
4. Reuses the existing UniFi design tokens and the existing replay panes unchanged.

## Constraints & Source of Truth

These facts drive the design — every decision below traces to one of them.

| Constraint             | Detail                                                                                                                                                      | Consequence                                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Data hierarchy         | `Org → Project → Service → Session (trace) → Step (span) → Event`                                                                                           | Navigation needs three scopes: org, project, session.                                               |
| Real API surface today | `/api/sessions`, `/api/sessions/:id`, `/auth/*`, `/api/tokens`                                                                                              | **No `/projects` endpoint.** Project scope is a client-side filter over `session.projectName`.      |
| Multi-tenancy          | One org per user (`me().orgId`); no members/teams/roles yet                                                                                                 | Org switcher shows the current org and reserves space; it does not actually switch orgs this phase. |
| Design system          | UniFi tokens already in `apps/web/src/index.css`: `bg-sidebar`, `--hairline`, `text-1..4`, `brand`, `--radius` (4/8/16/pill), `.u-*` type scale, `.tabular` | Reuse as-is. No new visual language.                                                                |
| Existing UI components | `badge`, `tabs`, `separator`, `collapsible` only                                                                                                            | Sidebar, dropdown/select, popover, tooltip, data-table, etc. must be added.                         |
| Existing detail page   | M3+ two-pane replay: `RoundTimeline` + `RoundDetail` (5 sections)                                                                                           | **Reused unchanged.** New layout wraps around it; internals are not touched.                        |
| i18n                   | M6 ships en / zh-CN / ja                                                                                                                                    | All new UI strings go through i18n keys, never hardcoded (per CLAUDE.md).                           |

## Information Architecture — Three Scopes

```
Organization (Workspace)     ← sidebar top, single org, reserves team-switch slot
   └─ Project                 ← sidebar top global switcher, client-side filter
        └─ Module             ← Observe / Monitoring / Analytics / Evals …
             └─ Session       ← list + detail (master-detail) within a module
```

**Project is a global filter context.** Selecting a project narrows the Sessions list (and future Monitoring/Analytics) to that project; selecting "All projects" removes the filter. The selection is persisted in the URL query (`?project=`) plus `localStorage`, so reload and link-sharing preserve it.

## Application Shell

```
┌──────────────┬───────────────────────────────────────────────────────┐
│  SIDEBAR     │  TOPBAR: breadcrumb ……………… [⌘K search] [⟳] [🌓 theme]  │
│  (collapsible)├───────────────────────────────────────────────────────┤
│              │                                                         │
│              │   CONTENT (router outlet)                               │
│              │                                                         │
└──────────────┴───────────────────────────────────────────────────────┘
```

- **Sidebar:** fixed width ~240px, collapsible to an icon rail ~56px; becomes a drawer on narrow screens. `bg-sidebar` with a right `border-hairline`.
- **Topbar:** thin bar (~44px). Holds **breadcrumb + page-level actions + global search/theme only**. No navigation links live here (all navigation is in the sidebar).
- **Content:** `bg-page`; each route owns its internal layout.

Auth pages (`/login`, `/register`, `/auth/*`) render **outside** the shell as full-screen centered forms.

## Sidebar

```
┌────────────────────────────┐
│ ◎ Argus          (logo)    │
│ ┌────────────────────────┐ │
│ │ ◈ Acme Org          ▾ │ │  ← org switcher (single org, reserved)
│ └────────────────────────┘ │
│ ┌────────────────────────┐ │
│ │ ▾ All projects         │ │  ← project switcher (client-side filter)
│ └────────────────────────┘ │
│                            │
│ OBSERVE                    │  ← section heading (u-h-sm / text-3)
│ ▣ Sessions                 │  ← implemented; active = brand tint
│ ◷ Monitoring        soon   │  ← grayed placeholder, not clickable
│ ◫ Analytics         soon   │
│ ⚖ Evals             soon   │
│                            │
│ ──────────────────────────  │
│ ⚙ Settings                 │  ← implemented (Tokens); expandable
│ ──────────────────────────  │
│ 👤 user@email          ▾   │  ← account menu: theme / language / logout
└────────────────────────────┘
```

**Behavior:**

- **Org switcher:** displays the current org name. A `▾` opens a menu showing the current org as the only entry plus a disabled "Manage teams — soon" footer. No real org switching this phase.
- **Project switcher:** a dropdown listing distinct `projectName` values derived from the sessions response, plus an "All projects" default. Selecting one sets `?project=` and filters downstream views.
- **Module list under "OBSERVE":**
  - `Sessions` — implemented; active state = `bg-tint-brand` + `text-brand` + a 2px brand left bar; hover = `bg-tile` only (color-only, no transform — per design system).
  - `Monitoring`, `Analytics`, `Evals` — **soon placeholders**: `text-4` gray + a trailing small `soon` pill, `cursor-default`, not clickable, tooltip "Coming soon". **No empty pages are created.**
- **Settings:** expandable. `Tokens` (implemented) plus `Members` / `General` / `Integrations` as grayed `soon` children.
- **Account menu:** moves to the sidebar bottom, replacing the current top-right user menu. Contains theme toggle, language switcher, and logout.

## Route Map

| Route                                      | Status                      | Notes                                                                                                                            |
| ------------------------------------------ | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `/login`, `/register`, `/auth/*`           | ✅ real                     | Outside the shell (full-screen centered).                                                                                        |
| `/` → `/sessions`                          | ✅ real                     | Redirect.                                                                                                                        |
| `/sessions`                                | ✅ real                     | List page (see below).                                                                                                           |
| `/sessions/$sessionId`                     | ✅ real                     | Detail page (see below).                                                                                                         |
| `/settings` → `/settings/tokens`           | ✅ real                     | Wrapped in a Settings sub-layout.                                                                                                |
| `/settings/{members,general,integrations}` | ⬜ soon                     | Sidebar entries grayed; **no pages built.**                                                                                      |
| `/monitoring`, `/analytics`, `/evals`      | ⬜ soon                     | Sidebar entries grayed; **no pages built.**                                                                                      |
| Project scope                              | `?project=` query param now | When a real `/projects` API lands later, this can migrate to a path scope (`/p/$projectId/...`) without restructuring the shell. |

## Sessions List Page

```
┌ Sessions ───────────────────────── [🔍 search] [status ▾] [⟳] ┐
│ SERVICE      PROJECT       STATUS  STARTED   DUR   STEPS  TOKENS │
│ intent-clf   customer-bot  ● ok    2m ago    1.2s   14     3.1k  │
│ planner      customer-bot  ● live  just now  —      6      1.2k  │
│ …                                                               │
└─────────────────────────────────────────────────────────────────┘
```

- **Columns:** Service, Project (auto-hidden when a project is selected), Status (badge incl. a `live` streaming state), Started (relative time, absolute on hover), Duration, Steps, Tokens. All numeric cells use `.tabular`.
- Row click navigates to detail. Sticky header; hairline row separators; skeleton loading; existing empty state retained.
- Extract the current bare `<table>` into a reusable `DataTable` component for future modules.

## Session Detail Page (master-detail + collapsible session rail)

The page wraps a shell layer around the **existing two-pane replay, which is reused unchanged**. Only a leftmost session rail and topbar switching are added.

```
┌ ‹ Sessions / customer-bot · intent-clf · 1a2b… ● ok   [‹][›] [⟳] [⌘K] ┐
├──────────┬────────────────────┬──────────────────────────────────────┤
│ SESSIONS │  ROUND TIMELINE    │  ROUND DETAIL                         │
│ rail     │  (existing,        │  (existing 5 sections:                │
│ default  │   unchanged)       │   Context / Trigger / LLM /           │
│ collapsed│  ● round 1         │   Tool / Raw — unchanged)             │
│ ⮞ expand │  ○ round 2         │                                       │
│  · s-1   │  …                 │                                       │
│  · s-2   │                    │                                       │
└──────────┴────────────────────┴──────────────────────────────────────┘
```

- **Leftmost session rail:** collapsible, **default collapsed** (to preserve the replay's horizontal space). When expanded, it lists sessions in the current project/filter; clicking one switches directly — this is the master-detail "session switching".
- **Topbar:** breadcrumb + status badge + `‹ ›` previous/next session + a session dropdown (quick jump) + refresh + `⌘K`.
- **Narrow screens:** the session rail becomes an overlay; the two replay panes keep their existing vertical-stack responsive behavior.

## New Components

All built on existing tokens; Radix primitives where applicable.

- `AppShell` / `Sidebar` (nav-item, section heading, collapsible rail)
- `DropdownMenu` + `Select` + `Popover` (switchers and account menu)
- `Tooltip`, `ScrollArea`, `Avatar`, `Skeleton`
- Theme toggle
- `Command` palette (`⌘K`, via `cmdk`) — **placeholder this phase** (opens but with minimal/disabled content)
- `DataTable` (extracted from the current sessions table)

## Phasing

Scope is the full IA, but construction is ordered by real functionality.

- **Phase 1 (immediate value):** `AppShell` + sidebar (Sessions active; Monitoring / Analytics / Evals + Settings children as `soon`) + project switcher (client-side filter) + org switcher (current org, reserved) + Settings sub-layout + account menu + thin topbar + `⌘K` placeholder. Move existing pages into the shell.
- **Phase 2:** detail-page session rail + previous/next + session dropdown.
- **Phase 3 (after backend support):** real `⌘K` search; real `/projects` API → upgrade project scope to a path scope; build the Monitoring / Analytics / Evals / Members pages.

## Out of Scope

- Actual organization switching / team management (no backend, single org per user).
- The Monitoring / Analytics / Evals page contents (placeholders only).
- A real `/projects` backend endpoint and path-based project scoping (deferred to Phase 3).
- Functional global search (`⌘K` is a placeholder this phase).
- Any change to `RoundTimeline` / `RoundDetail` internals.

## i18n Note

M6 ships en / zh-CN / ja. Every new string introduced by this work must use an i18n key, never a hardcoded literal (per CLAUDE.md). Strings added before M6's i18n machinery exists should be centralized so they are trivially extractable later.
