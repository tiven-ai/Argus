# Argus M5a — UniFi Visual System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the UniFi-authentic design system (`docs/design/DESIGN.md`) to the whole web app — establish the design tokens in `index.css`, load Inter, then re-theme every component (atoms, shell, timeline, detail, auth pages) so the UI looks like a finished UniFi Console product instead of shadcn defaults.

**Architecture:** All visual truth lives in CSS custom properties on `:root` (light) and `.dark` (dark), exposed to Tailwind v4 utilities via `@theme inline`. Components stop using raw palette classes (`neutral-*`, `blue-*`, `amber-*`) and use semantic token utilities (`bg-page`, `border-hairline`, `text-text-1`, `text-brand`, `bg-tint-success`, etc.) plus the `.u-*` typography classes and `.tabular` numeric class. No component JSX logic changes — only `className` values and a few wrapper structures. Dark-mode tokens are defined and correct but not wired to a toggle in M5a (a `.dark` class on `<html>` activates them; the toggle UI is deferred).

**Tech Stack additions:** `@fontsource-variable/inter` (self-hosted Inter variable font — no Google Fonts CDN, friendly to private deployments). No other new deps.

**The Five Non-obvious Truths (from DESIGN.md — internalize before touching any component):**

1. **Cards are transparent** — `rgba(0,0,0,0)` bg. White comes from the single `bg-page` panel. Cards are NOT filled.
2. **Cards have no shadow** — delimited by a 1px hairline border (`hsla(214 8% 14% / 0.07)`). Shadow is for popovers/dialogs only.
3. **Radii are small** — default `4px` (`rounded`), icon tiles `8px` (`rounded-md`). Not 12/14.
4. **Padding is tight** — card padding `12px` (`p-3`), card gap `8px` (`gap-2`). Not 24/20.
5. **Base font is `13px/20px` Inter** — headings 15px, captions 11px, metrics 27px.

**Scope deliberately excluded:**

- Dark-mode toggle UI (tokens defined, `.dark` works if applied, but no switch in M5a)
- gRPC ingest (that's M5b)
- Recharts/charts (no charts in the app yet)
- New components beyond re-theming existing ones

**Reference:** [docs/design/DESIGN.md](../../design/DESIGN.md) is the authority. When this plan and DESIGN.md disagree, DESIGN.md wins.

---

## File Structure (touched by M5a)

```
apps/web/
├── package.json                              (MODIFIED: +@fontsource-variable/inter)
├── index.html                                (MODIFIED: lang + title only if needed — no font link, fontsource is imported in JS)
└── src/
    ├── index.css                             (REWRITTEN: tokens + @theme inline + .u-* + base)
    ├── main.tsx                              (MODIFIED: import '@fontsource-variable/inter')
    ├── components/ui/
    │   ├── badge.tsx                          (REWRITTEN: token variants)
    │   ├── tabs.tsx                           (RE-THEMED: token classes)   [unused after RT but kept]
    │   ├── separator.tsx                      (RE-THEMED: bg-hairline)
    │   └── collapsible.tsx                    (unchanged — no visual classes)
    ├── routes/
    │   ├── __root.tsx                         (RE-THEMED: shell)
    │   ├── login.tsx                          (RE-THEMED)
    │   ├── register.tsx                       (RE-THEMED)
    │   ├── sessions/index.tsx                 (RE-THEMED: list table)
    │   └── settings/tokens.tsx                (RE-THEMED)
    └── features/session-replay/
        ├── topbar/SessionTopbar.tsx           (RE-THEMED)
        ├── timeline/RoundRow.tsx              (RE-THEMED)
        ├── timeline/RoundTimeline.tsx         (RE-THEMED: empty state)
        ├── detail/RoundHeader.tsx             (RE-THEMED)
        ├── detail/RoundDetail.tsx             (RE-THEMED: section headers)
        └── detail/sections/
            ├── ContextSection.tsx             (RE-THEMED)
            ├── TriggerSection.tsx             (RE-THEMED)
            ├── LlmResponseSection.tsx         (RE-THEMED)
            ├── ToolExecutionsSection.tsx      (RE-THEMED)
            ├── RawSection.tsx                 (RE-THEMED)
            └── tool-displays.tsx              (RE-THEMED)
```

---

## Token → utility cheat sheet (apply consistently across all components)

This is the find-and-replace map every re-theming task follows.

| Old shadcn class                           | New UniFi token class                 | Notes                                                |
| ------------------------------------------ | ------------------------------------- | ---------------------------------------------------- |
| `text-neutral-900` / `text-black`          | `text-text-1`                         | headings, metrics                                    |
| `text-neutral-700` / `text-neutral-600`    | `text-text-2`                         | body                                                 |
| `text-neutral-500`                         | `text-text-3`                         | captions, icon default                               |
| `text-neutral-400`                         | `text-text-4`                         | disabled / placeholder / faint                       |
| `bg-white` (page/region)                   | `bg-page`                             | the one white panel                                  |
| `bg-neutral-50` / `bg-neutral-100` (inset) | `bg-tile`                             | small fills behind code/json                         |
| `border` / `border-neutral-200`            | `border-hairline`                     | every card edge / divider                            |
| `hover:bg-neutral-50`                      | `hover:bg-tile`                       | quiet row/button hover                               |
| `text-blue-700` / `text-blue-600`          | `text-brand`                          | links, primary                                       |
| `bg-blue-50` (active/tint)                 | `bg-tint-brand`                       | active row, brand pill                               |
| `border-l-blue-500`                        | `border-l-brand`                      | active row left border                               |
| `bg-amber-50 border-amber-100`             | `bg-tint-warning` + `border-hairline` | LLM text panel uses `bg-tile` (neutral) — see Task 5 |
| `bg-green-50 border-green-100`             | `bg-tint-success`                     | tool result panel                                    |
| `text-red-600` / `text-red-700`            | `text-danger`                         | errors                                               |
| `bg-red-600 text-white`                    | `bg-danger text-white`                | destructive badge                                    |
| `bg-emerald-500` (live dot)                | `bg-success`                          | LIVE indicator                                       |
| `rounded` (already 4px)                    | `rounded`                             | keep                                                 |
| `rounded-lg` on cards                      | `rounded`                             | DESIGN.md: cards are 4px, not lg                     |
| `text-base font-semibold` (card title)     | `u-h-lg text-text-1`                  | 15/24                                                |
| `text-sm` body                             | `u-body` or `text-[13px] leading-5`   | 13/20                                                |
| `text-xs` caption                          | `u-caption text-text-3`               | 11/16, NO uppercase/tracking                         |
| `font-mono` ids                            | keep `font-mono` + `text-text-4`      |                                                      |
| `tabular-nums`                             | `tabular`                             | the project class                                    |
| `p-4` / `p-6` on dense panels              | `p-3`                                 | 12px                                                 |
| `gap-3` / `gap-4` within card              | `gap-2`                               | 8px                                                  |

**Hard rules** (from DESIGN.md §"The 10 Rules"):

- Cards: `border border-hairline rounded p-3`. No `bg-*`, no `shadow-*`.
- No `uppercase` / `tracking-wide` on labels.
- Buttons: `h-8 px-4 rounded` + regular weight (`font-normal`, never bold). Primary = `border border-brand text-brand hover:bg-tint-brand`. Solid = `bg-brand text-white hover:bg-brand-hover`. Secondary = `border border-hairline text-text-1 hover:bg-tile`.
- Hover is quiet: only `hover:bg-tile` (rows/buttons) or `hover:border-hairline-strong` (cards). No transform/scale/shadow-swap.
- Numbers get `.tabular`.

---

## Task 1: Design tokens in index.css + Inter font

**Files:**

- Modify: `apps/web/package.json` (add `@fontsource-variable/inter`)
- Modify: `apps/web/src/index.css` (full rewrite)
- Modify: `apps/web/src/main.tsx` (import font)

### Step 1: Add the font dependency to `apps/web/package.json`

Add `"@fontsource-variable/inter": "^5.1.0"` to `dependencies` (alphabetical position — right after `@argus/shared-types`). Keep everything else identical. The dependencies block becomes:

```json
  "dependencies": {
    "@argus/shared-types": "workspace:*",
    "@fontsource-variable/inter": "^5.1.0",
    "@radix-ui/react-collapsible": "^1.1.0",
    "@radix-ui/react-separator": "^1.1.0",
    "@radix-ui/react-tabs": "^1.1.0",
    "@tanstack/react-query": "^5.50.0",
    "@tanstack/react-router": "^1.60.0",
    "@tanstack/react-virtual": "^3.10.0",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.0",
    "lucide-react": "^0.460.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "tailwind-merge": "^2.5.0",
    "zod": "^3.23.0"
  },
```

### Step 2: `pnpm install`

```bash
pnpm install
```

### Step 3: Rewrite `apps/web/src/index.css`

```css
@import 'tailwindcss';

/* ----------------------------------------------------------------------------
 * UniFi-authentic design tokens. Values measured from the live UniFi Network
 * dashboard — see docs/design/DESIGN.md. Light mode is :root; dark mode is the
 * .dark class (not wired to a toggle in M5a, but correct when applied).
 * ------------------------------------------------------------------------- */

:root {
  color-scheme: light;

  --page: #ffffff;
  --surface: #ffffff;
  --inset: hsl(214 8% 98%);
  --tile: hsl(214 8% 96%);
  --hairline: hsla(214 8% 14% / 0.07);
  --hairline-strong: hsla(214 8% 14% / 0.12);

  --text-1: hsl(214 8% 14%);
  --text-2: hsl(214 8% 34%);
  --text-3: hsl(214 8% 54%);
  --text-4: hsl(214 8% 78%);

  --brand: hsl(214 100% 50%);
  --brand-hover: hsl(214 100% 60%);
  --brand-active: hsl(214 100% 40%);

  --success: hsl(138 59% 51%);
  --warning: hsl(37 91% 55%);
  --danger: hsl(358 80% 66%);

  --tint-brand: hsl(214 100% 95%);
  --tint-success: hsl(138 60% 95%);
  --tint-warning: hsl(37 91% 95%);
  --tint-danger: hsl(357 82% 96%);

  --popover: #ffffff;
  --sidebar: #ffffff;

  --shadow-popover: 0 4px 12px hsla(214 8% 14% / 0.08), 0 0 1px hsla(214 8% 14% / 0.08);
  --shadow-dialog: 0 8px 24px hsla(214 8% 14% / 0.08), 0 0 1px hsla(214 8% 14% / 0.08);
  --shadow-modal: 0 12px 48px hsla(214 8% 14% / 0.12), 0 0 1px hsla(214 8% 14% / 0.08);
}

.dark {
  color-scheme: dark;

  --page: hsl(214 8% 8%);
  --surface: hsl(214 8% 8%);
  --inset: hsl(214 8% 17%);
  --tile: hsl(214 8% 17%);
  --hairline: hsla(214 8% 98% / 0.07);
  --hairline-strong: hsla(214 8% 98% / 0.12);

  --text-1: hsl(214 8% 96%);
  --text-2: hsl(214 8% 88%);
  --text-3: hsl(214 8% 60%);
  --text-4: hsl(214 8% 40%);

  --brand: hsl(214 100% 64%);
  --brand-hover: hsl(214 100% 72%);
  --brand-active: hsl(214 100% 56%);

  --tint-brand: hsl(213 88% 16%);
  --tint-success: hsl(138 40% 14%);
  --tint-warning: hsl(37 50% 16%);
  --tint-danger: hsl(357 50% 18%);

  --popover: hsl(214 8% 17%);
  --sidebar: hsl(214 8% 12%);
}

/* Expose tokens to Tailwind v4 utilities: bg-page, border-hairline,
 * text-text-1, text-brand, bg-tint-success, rounded-md (8px), etc. */
@theme inline {
  --color-page: var(--page);
  --color-surface: var(--surface);
  --color-inset: var(--inset);
  --color-tile: var(--tile);
  --color-hairline: var(--hairline);
  --color-hairline-strong: var(--hairline-strong);

  --color-text-1: var(--text-1);
  --color-text-2: var(--text-2);
  --color-text-3: var(--text-3);
  --color-text-4: var(--text-4);

  --color-brand: var(--brand);
  --color-brand-hover: var(--brand-hover);
  --color-brand-active: var(--brand-active);

  --color-success: var(--success);
  --color-warning: var(--warning);
  --color-danger: var(--danger);

  --color-tint-brand: var(--tint-brand);
  --color-tint-success: var(--tint-success);
  --color-tint-warning: var(--tint-warning);
  --color-tint-danger: var(--tint-danger);

  --color-popover: var(--popover);
  --color-sidebar: var(--sidebar);

  --radius: 4px;
  --radius-md: 8px;
  --radius-lg: 16px;
  --radius-pill: 9999px;

  --font-sans: 'Inter Variable', Inter, ui-sans-serif, system-ui, sans-serif;
}

@layer base {
  html,
  body,
  #root {
    height: 100%;
  }

  body {
    font-family: var(--font-sans);
    font-size: 13px;
    line-height: 20px;
    color: var(--text-2);
    background: var(--page);
    -webkit-font-smoothing: antialiased;
  }
}

/* UniFi typography scale + tabular numbers (see DESIGN.md §Typography). */
@layer components {
  .u-body {
    font-weight: 400;
    font-size: 13px;
    line-height: 20px;
  }
  .u-caption {
    font-weight: 400;
    font-size: 11px;
    line-height: 16px;
  }
  .u-h-sm {
    font-weight: 600;
    font-size: 11px;
    line-height: 16px;
  }
  .u-h-md {
    font-weight: 600;
    font-size: 13px;
    line-height: 20px;
  }
  .u-h-lg {
    font-weight: 600;
    font-size: 15px;
    line-height: 24px;
  }
  .u-h-xl {
    font-weight: 600;
    font-size: 19px;
    line-height: 28px;
  }
  .u-metric {
    font-weight: 600;
    font-size: 27px;
    line-height: 36px;
  }
  .tabular {
    font-variant-numeric: tabular-nums;
  }
}
```

### Step 4: Import the font in `apps/web/src/main.tsx`

Add the fontsource import as the FIRST import line (so the `@font-face` rules load before the app's CSS cascade). The top of `main.tsx` becomes:

```tsx
import '@fontsource-variable/inter'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import { queryClient } from './lib/query-client'
import './index.css'
```

(Keep the rest of `main.tsx` exactly as it is.)

### Step 5: Typecheck + build

```bash
pnpm --filter @argus/web typecheck
pnpm --filter @argus/web build
```

Expected: 0 errors. Build succeeds. The bundle now includes the Inter font files (CSS size grows ~a few KB; woff2 files emitted to dist/assets).

### Step 6: Commit

```bash
git add apps/web/package.json apps/web/src/index.css apps/web/src/main.tsx pnpm-lock.yaml
git commit -m "feat(web): UniFi design tokens + Inter font (index.css theme layer)"
```

---

## Task 2: Re-theme atom components (badge, separator, tabs)

**Files:**

- Modify: `apps/web/src/components/ui/badge.tsx` (full replace)
- Modify: `apps/web/src/components/ui/separator.tsx` (full replace)
- Modify: `apps/web/src/components/ui/tabs.tsx` (full replace)

`collapsible.tsx` has no visual classes (pure Radix re-export) — leave it.

### Step 1: Replace `apps/web/src/components/ui/badge.tsx`

UniFi badges are status pills: `rounded-pill`, soft tint background, solid accent text, 11px. No solid-dark default.

```tsx
import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-[11px] leading-4 font-normal tabular',
  {
    variants: {
      variant: {
        // "default" = success/active style (most badges in the app are OK status)
        default: 'bg-tint-success text-success',
        secondary: 'bg-tile text-text-3',
        destructive: 'bg-tint-danger text-danger',
        brand: 'bg-tint-brand text-brand',
        warning: 'bg-tint-warning text-warning',
        outline: 'border border-hairline text-text-2',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
```

> NOTE: this adds a `brand` and `warning` variant and changes `default` to the success-tint look. Existing callers pass `default` (OK status → now green tint, correct), `destructive` (ERROR → danger tint, correct), `secondary` (UNSET/revoked → neutral tile, correct). No caller code changes needed.

### Step 2: Replace `apps/web/src/components/ui/separator.tsx`

```tsx
import * as React from 'react'
import * as SeparatorPrimitive from '@radix-ui/react-separator'
import { cn } from '@/lib/utils'

const Separator = React.forwardRef<
  React.ElementRef<typeof SeparatorPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>
>(({ className, orientation = 'horizontal', decorative = true, ...props }, ref) => (
  <SeparatorPrimitive.Root
    ref={ref}
    decorative={decorative}
    orientation={orientation}
    className={cn(
      'shrink-0 bg-hairline',
      orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
      className,
    )}
    {...props}
  />
))
Separator.displayName = SeparatorPrimitive.Root.displayName

export { Separator }
```

### Step 3: Replace `apps/web/src/components/ui/tabs.tsx`

(Tabs is not currently mounted anywhere after the round rework, but keep it themed for future use.)

```tsx
import * as React from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cn } from '@/lib/utils'

const Tabs = TabsPrimitive.Root

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      'inline-flex h-8 items-center justify-center rounded bg-tile p-0.5 text-text-3',
      className,
    )}
    {...props}
  />
))
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'inline-flex items-center justify-center whitespace-nowrap rounded px-3 py-1 text-[13px] leading-5 font-normal transition-colors',
      'data-[state=active]:bg-page data-[state=active]:text-text-1',
      className,
    )}
    {...props}
  />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn('focus-visible:outline-none', className)}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
```

### Step 4: Typecheck + build

```bash
pnpm --filter @argus/web typecheck
pnpm --filter @argus/web build
```

Expected: 0 errors.

### Step 5: Commit

```bash
git add apps/web/src/components/ui
git commit -m "feat(web): re-theme badge/separator/tabs to UniFi tokens"
```

---

## Task 3: Re-theme app shell (\_\_root) + sessions list

**Files:**

- Modify: `apps/web/src/routes/__root.tsx` (full replace)
- Modify: `apps/web/src/routes/sessions/index.tsx` (full replace)

### Step 1: Replace `apps/web/src/routes/__root.tsx`

The header is a hairline-bottom bar on `bg-page`; nav links are `text-text-3 hover:text-text-1`; the brand wordmark is `text-text-1`. UserMenu dropdown gets `shadow-popover` + `rounded-md` + `bg-popover`.

```tsx
import { createRootRoute, Link, Outlet, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { AuthProvider, useAuth } from '../lib/auth-provider'

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
  const { user, loading } = useAuth()
  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center text-text-3 u-body">Loading…</div>
    )
  }
  return (
    <div className="h-screen flex flex-col bg-page text-text-2">
      <header className="border-b border-hairline px-6 py-2.5 flex items-center gap-4 shrink-0">
        <Link to="/" className="u-h-lg text-text-1 tracking-tight">
          Argus
        </Link>
        <nav className="u-body flex items-center gap-3">
          <Link to="/sessions" className="text-text-3 hover:text-text-1 transition-colors">
            Sessions
          </Link>
          {user && (
            <Link to="/settings/tokens" className="text-text-3 hover:text-text-1 transition-colors">
              Tokens
            </Link>
          )}
        </nav>
        <div className="ml-auto">{user ? <UserMenu /> : <SignInLink />}</div>
      </header>
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  )
}

function SignInLink() {
  return (
    <Link to="/login" className="u-body text-brand hover:text-brand-hover transition-colors">
      Sign in
    </Link>
  )
}

function UserMenu() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)

  async function handleLogout() {
    await logout()
    setOpen(false)
    void navigate({ to: '/login' })
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="h-8 px-4 rounded border border-hairline text-text-1 u-body hover:bg-tile transition-colors"
      >
        {user!.email}
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-48 bg-popover border border-hairline rounded-md shadow-[var(--shadow-popover)] u-body z-50">
          <button
            type="button"
            onClick={handleLogout}
            className="block w-full text-left px-3 py-2 text-text-2 hover:bg-tile transition-colors rounded-md"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
```

### Step 2: Replace `apps/web/src/routes/sessions/index.tsx`

List is a dense table. Header row uses `u-caption text-text-3`. Rows hairline-separated, `hover:bg-tile`. Trace link is `text-brand`. Numbers `tabular`.

```tsx
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { fetchSessions } from '../../lib/api'

export const Route = createFileRoute('/sessions/')({
  component: SessionsList,
})

function SessionsList() {
  const navigate = useNavigate()
  const { data, isLoading, error } = useQuery({
    queryKey: ['sessions'],
    queryFn: fetchSessions,
    retry: false,
  })

  useEffect(() => {
    if (error instanceof Error && error.message === 'UNAUTHENTICATED') {
      void navigate({ to: '/login' })
    }
  }, [error, navigate])

  if (isLoading) return <p className="p-3 u-body text-text-3">Loading…</p>
  if (error) return <p className="p-3 u-body text-danger">Error: {String(error)}</p>
  if (!data || data.sessions.length === 0) {
    return (
      <div className="p-6 u-body text-text-3">
        <p>No sessions yet.</p>
        <p className="mt-2">
          Try <code className="bg-tile px-1 rounded text-text-2">pnpm db:seed</code> or send an OTLP
          payload to <code className="bg-tile px-1 rounded text-text-2">POST /v1/traces</code>.
        </p>
      </div>
    )
  }

  return (
    <div className="p-6 overflow-auto h-full">
      <h2 className="u-h-lg text-text-1 mb-3">Sessions</h2>
      <div className="border border-hairline rounded">
        <table className="w-full u-body">
          <thead>
            <tr className="text-left u-caption text-text-3 border-b border-hairline">
              <th className="font-normal px-3 py-2">Project</th>
              <th className="font-normal px-3 py-2">Service</th>
              <th className="font-normal px-3 py-2">Trace</th>
              <th className="font-normal px-3 py-2">Steps</th>
              <th className="font-normal px-3 py-2">Started</th>
            </tr>
          </thead>
          <tbody>
            {data.sessions.map((s) => (
              <tr
                key={s.id}
                className="border-b border-hairline last:border-0 hover:bg-tile transition-colors"
              >
                <td className="px-3 py-2 text-text-1">{s.projectName}</td>
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
                <td className="px-3 py-2 text-text-3 tabular">
                  {new Date(s.startedAt).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

### Step 3: Typecheck + build

```bash
pnpm --filter @argus/web typecheck
pnpm --filter @argus/web build
```

### Step 4: Commit

```bash
git add apps/web/src/routes/__root.tsx apps/web/src/routes/sessions/index.tsx
git commit -m "feat(web): re-theme app shell + sessions list to UniFi tokens"
```

---

## Task 4: Re-theme timeline (RoundRow + RoundTimeline)

**Files:**

- Modify: `apps/web/src/features/session-replay/timeline/RoundRow.tsx` (full replace)
- Modify: `apps/web/src/features/session-replay/timeline/RoundTimeline.tsx` (empty-state only)

### Step 1: Replace `apps/web/src/features/session-replay/timeline/RoundRow.tsx`

Active row: `bg-tint-brand` + `border-l-brand`. Idle: `hover:bg-tile`. Label `u-h-md text-text-1`, snippet `u-caption text-text-3`, index + duration `text-text-4 tabular`.

```tsx
import type { Round } from '../types/round'
import { cn } from '@/lib/utils'
import { durationMs, findEvent, formatDuration } from '../lib/step-helpers'
import { iconForRoundTrigger, labelForRoundTrigger } from './round-icons'

interface Props {
  round: Round
  index: number
  active: boolean
  onClick: () => void
}

function snippetForTrigger(round: Round): string | null {
  if (!round.trigger) return null
  if (round.trigger.kind === 'user_message') {
    const text = findEvent(round.trigger, 'argus.input')?.attributes.text
    return typeof text === 'string' ? text : null
  }
  if (round.trigger.kind === 'tool_call') {
    const output = findEvent(round.trigger, 'argus.output')?.attributes
    if (output && typeof output === 'object') {
      const summary = JSON.stringify(output)
      return summary.length > 80 ? summary.slice(0, 80) + '…' : summary
    }
  }
  return null
}

export function RoundRow({ round, index, active, onClick }: Props) {
  const Icon = iconForRoundTrigger(round)
  const label = labelForRoundTrigger(round)
  const snippet = snippetForTrigger(round)
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full flex items-start gap-2 px-3 py-2 text-left border-l-2 transition-colors',
        active ? 'bg-tint-brand border-l-brand' : 'border-l-transparent hover:bg-tile',
      )}
    >
      <span className="u-caption text-text-4 w-5 shrink-0 mt-0.5 tabular">{index + 1}</span>
      <Icon className="h-4 w-4 mt-0.5 text-text-3 shrink-0" strokeWidth={1.75} />
      <div className="flex-1 min-w-0">
        <p className="u-h-md text-text-1 truncate">{label}</p>
        {snippet && <p className="u-caption text-text-3 truncate">{snippet}</p>}
      </div>
      <div className="u-caption text-text-4 shrink-0 mt-0.5 tabular">
        {formatDuration(durationMs(round.llmCall))}
      </div>
    </button>
  )
}
```

### Step 2: Modify the empty-state block in `apps/web/src/features/session-replay/timeline/RoundTimeline.tsx`

Find the empty-state `return` (the `rounds.length === 0` branch) and replace its JSX with token-styled markup. The block currently reads:

```tsx
if (rounds.length === 0) {
  return (
    <div className="p-4 text-sm text-neutral-500">
      <p>No rounds yet.</p>
      <p className="mt-2">
        Rounds appear when a session contains at least one LLM call. Try{' '}
        <code className="bg-neutral-100 px-1 rounded">pnpm db:seed</code>.
      </p>
    </div>
  )
}
```

Replace with:

```tsx
if (rounds.length === 0) {
  return (
    <div className="p-3 u-body text-text-3">
      <p>No rounds yet.</p>
      <p className="mt-2">
        Rounds appear when a session contains at least one LLM call. Try{' '}
        <code className="bg-tile px-1 rounded text-text-2">pnpm db:seed</code>.
      </p>
    </div>
  )
}
```

(Leave the virtualizer logic and the main return untouched.)

### Step 3: Typecheck + build

```bash
pnpm --filter @argus/web typecheck
pnpm --filter @argus/web build
```

### Step 4: Commit

```bash
git add apps/web/src/features/session-replay/timeline
git commit -m "feat(web): re-theme round timeline to UniFi tokens"
```

---

## Task 5: Re-theme detail sections + tool-displays

**Files:**

- Modify: `apps/web/src/features/session-replay/detail/sections/tool-displays.tsx` (full replace)
- Modify: `apps/web/src/features/session-replay/detail/sections/ContextSection.tsx` (full replace)
- Modify: `apps/web/src/features/session-replay/detail/sections/TriggerSection.tsx` (full replace)
- Modify: `apps/web/src/features/session-replay/detail/sections/LlmResponseSection.tsx` (full replace)
- Modify: `apps/web/src/features/session-replay/detail/sections/ToolExecutionsSection.tsx` (full replace)
- Modify: `apps/web/src/features/session-replay/detail/sections/RawSection.tsx` (full replace)

Common patterns for this task:

- Section sub-label: `u-caption text-text-3` (NO uppercase).
- Code/JSON blocks: `bg-tile border border-hairline rounded p-2 text-[11px] leading-4 text-text-2 overflow-auto`.
- Cards (tool defs, tool calls, messages): `border border-hairline rounded p-2`.
- User bubble: `bg-tint-brand` + `text-text-1`. Tool result: `bg-tint-success`. LLM text: `bg-tile` (neutral — DESIGN.md says no large colored fills; the amber was a shadcn artifact).
- Icon tiles for the bubble avatars: `w-7 h-7 rounded-md border border-hairline bg-page flex items-center justify-center` with `text-brand` / `text-text-3` icon.

### Step 1: Replace `tool-displays.tsx`

```tsx
import { Wrench } from 'lucide-react'

interface ToolSchema {
  name?: string
  description?: string
  parameters?: {
    type?: string
    properties?: Record<string, ToolProperty>
    required?: string[]
  }
}

interface ToolProperty {
  type?: string
  description?: string
}

interface ToolCall {
  id?: string
  name?: string
  arguments?: unknown
}

export function ToolDefinitionsList({ tools }: { tools: unknown[] }) {
  return (
    <ul className="space-y-2">
      {tools.map((tool, i) => {
        const key = (tool as { name?: string })?.name ?? `tool-${i}`
        return (
          <li key={key}>
            <ToolDefinitionCard tool={tool} />
          </li>
        )
      })}
    </ul>
  )
}

function ToolDefinitionCard({ tool }: { tool: unknown }) {
  const t = tool as ToolSchema
  const params = t.parameters?.properties ?? {}
  const required = new Set(t.parameters?.required ?? [])
  const hasParams = Object.keys(params).length > 0
  return (
    <div className="border border-hairline rounded p-2 space-y-2">
      <div className="flex items-baseline gap-2">
        <Wrench className="h-3.5 w-3.5 text-text-3 shrink-0" strokeWidth={1.75} />
        <span className="font-mono u-h-md text-text-1">{t.name ?? '(unnamed)'}</span>
      </div>
      {t.description && <p className="u-caption text-text-3">{t.description}</p>}
      {hasParams && (
        <div>
          <p className="u-caption text-text-3 mb-1">Parameters</p>
          <ul className="u-caption space-y-0.5">
            {Object.entries(params).map(([key, prop]) => (
              <li key={key}>
                <span className="font-mono text-text-2">{key}</span>{' '}
                <span className="text-text-3">
                  ({prop?.type ?? 'any'}
                  {required.has(key) ? ', required' : ''})
                </span>
                {prop?.description && <span className="text-text-3"> — {prop.description}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

export function ToolCallList({ toolCalls }: { toolCalls: unknown[] }) {
  return (
    <ul className="space-y-2">
      {toolCalls.map((tc, i) => {
        const obj = tc as ToolCall
        return (
          <li key={obj.id ?? i} className="border border-hairline rounded p-2 space-y-1.5">
            <div className="flex items-center gap-2">
              <Wrench className="h-3.5 w-3.5 text-text-3 shrink-0" strokeWidth={1.75} />
              <span className="font-mono u-h-md text-text-1">{obj.name ?? '(unnamed)'}</span>
              {obj.id && <span className="u-caption text-text-4 font-mono ml-auto">{obj.id}</span>}
            </div>
            {obj.arguments !== undefined && <ToolArguments args={obj.arguments} />}
          </li>
        )
      })}
    </ul>
  )
}

function ToolArguments({ args }: { args: unknown }) {
  let parsed: unknown = args
  if (typeof args === 'string') {
    try {
      parsed = JSON.parse(args)
    } catch {
      // leave as raw string
    }
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const entries = Object.entries(parsed as Record<string, unknown>)
    if (entries.length === 0) {
      return <p className="u-caption text-text-4">(no arguments)</p>
    }
    return (
      <div>
        <p className="u-caption text-text-3 mb-1">Arguments</p>
        <table className="u-caption w-full">
          <tbody>
            {entries.map(([key, value]) => (
              <tr key={key} className="border-t border-hairline">
                <td className="font-mono pr-3 py-0.5 text-text-3 align-top w-1/4">{key}</td>
                <td className="font-mono py-0.5 break-all text-text-2">
                  {typeof value === 'string' ? value : JSON.stringify(value)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
  return (
    <pre className="u-caption bg-tile border border-hairline p-2 rounded overflow-auto text-text-2">
      {typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2)}
    </pre>
  )
}
```

### Step 2: Replace `ContextSection.tsx`

```tsx
import type { Round } from '../../types/round'
import { findEvent } from '../../lib/step-helpers'
import { ToolCallList, ToolDefinitionsList } from './tool-displays'

interface Props {
  round: Round
}

function MessageRow({
  role,
  content,
  toolCalls,
}: {
  role: string
  content?: string
  toolCalls?: unknown[]
}) {
  let displayContent = content
  if (role === 'tool' && typeof content === 'string') {
    try {
      displayContent = JSON.stringify(JSON.parse(content), null, 2)
    } catch {
      // leave as raw
    }
  }
  return (
    <li className="border border-hairline rounded p-2">
      <p className="u-caption text-text-3 mb-1">{role}</p>
      {displayContent && displayContent.length > 0 && (
        <pre className="whitespace-pre-wrap u-body text-text-2">{displayContent}</pre>
      )}
      {toolCalls && toolCalls.length > 0 && (
        <div className="mt-2">
          <ToolCallList toolCalls={toolCalls} />
        </div>
      )}
    </li>
  )
}

export function ContextSection({ round }: Props) {
  const input = findEvent(round.llmCall, 'argus.input')?.attributes ?? {}
  const messages = Array.isArray(input.messages) ? input.messages : []
  const tools = Array.isArray(input.tools) ? input.tools : []

  const explicit = typeof input.system_prompt === 'string' ? input.system_prompt : null
  const systemFromMessages =
    messages.find((m) => (m as { role?: unknown }).role === 'system') ?? null
  const systemPrompt =
    explicit ??
    (typeof (systemFromMessages as { content?: unknown })?.content === 'string'
      ? (systemFromMessages as { content: string }).content
      : null)

  const nonSystemMessages = messages.filter((m) => (m as { role?: unknown }).role !== 'system')

  return (
    <div className="space-y-4">
      {systemPrompt && (
        <div>
          <h4 className="u-caption text-text-3 mb-1">System prompt</h4>
          <pre className="u-body bg-tile border border-hairline p-3 rounded whitespace-pre-wrap text-text-2">
            {systemPrompt}
          </pre>
        </div>
      )}
      {tools.length > 0 && (
        <div>
          <h4 className="u-caption text-text-3 mb-1">Tools available</h4>
          <ToolDefinitionsList tools={tools} />
        </div>
      )}
      {nonSystemMessages.length > 0 && (
        <div>
          <h4 className="u-caption text-text-3 mb-1">Message history</h4>
          <ul className="space-y-2">
            {nonSystemMessages.map((m, i) => {
              const obj = m as { role?: unknown; content?: unknown; tool_calls?: unknown[] }
              return (
                <MessageRow
                  key={i}
                  role={String(obj.role ?? 'unknown')}
                  content={typeof obj.content === 'string' ? obj.content : undefined}
                  toolCalls={Array.isArray(obj.tool_calls) ? obj.tool_calls : undefined}
                />
              )
            })}
          </ul>
        </div>
      )}
      {!systemPrompt && tools.length === 0 && nonSystemMessages.length === 0 && (
        <p className="u-body text-text-3">(no context captured for this round)</p>
      )}
    </div>
  )
}
```

### Step 3: Replace `TriggerSection.tsx`

```tsx
import { User, Wrench } from 'lucide-react'
import type { Round } from '../../types/round'
import { findEvent } from '../../lib/step-helpers'

interface Props {
  round: Round
}

export function TriggerSection({ round }: Props) {
  const t = round.trigger
  if (!t) {
    return (
      <p className="u-body text-text-3">
        (initial round — no preceding user message or tool result)
      </p>
    )
  }

  if (t.kind === 'user_message') {
    const text = String(findEvent(t, 'argus.input')?.attributes.text ?? '(no text)')
    return (
      <div className="flex gap-3 items-start">
        <div className="w-7 h-7 rounded-md border border-hairline bg-page flex items-center justify-center shrink-0">
          <User className="h-4 w-4 text-brand" strokeWidth={1.75} />
        </div>
        <div className="rounded bg-tint-brand px-3 py-2 max-w-prose whitespace-pre-wrap u-body text-text-1">
          {text}
        </div>
      </div>
    )
  }

  if (t.kind === 'tool_call') {
    const toolName = t.componentName ?? t.name
    const output = findEvent(t, 'argus.output')?.attributes ?? {}
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 u-body text-text-2">
          <Wrench className="h-4 w-4 text-text-3" strokeWidth={1.75} />
          <span>
            Tool result · <span className="font-mono text-text-1">{toolName}</span>
          </span>
        </div>
        <pre className="u-caption bg-tint-success p-3 rounded overflow-auto text-text-1">
          {JSON.stringify(output, null, 2)}
        </pre>
      </div>
    )
  }

  return (
    <pre className="u-caption bg-tile border border-hairline p-3 rounded overflow-auto text-text-2">
      {JSON.stringify(t, null, 2)}
    </pre>
  )
}
```

### Step 4: Replace `LlmResponseSection.tsx`

```tsx
import type { Round } from '../../types/round'
import { findEvent } from '../../lib/step-helpers'
import { ToolCallList } from './tool-displays'

interface Props {
  round: Round
}

export function LlmResponseSection({ round }: Props) {
  const output = findEvent(round.llmCall, 'argus.output')?.attributes ?? {}
  const text = typeof output.text === 'string' ? output.text : undefined
  const toolCalls = Array.isArray(output.tool_calls) ? output.tool_calls : undefined
  const stopReason = typeof output.stop_reason === 'string' ? output.stop_reason : undefined

  return (
    <div className="space-y-4">
      {text && (
        <div>
          <h4 className="u-caption text-text-3 mb-1">Text</h4>
          <pre className="u-body bg-tile border border-hairline p-3 rounded whitespace-pre-wrap text-text-1">
            {text}
          </pre>
        </div>
      )}
      {toolCalls && (
        <div>
          <h4 className="u-caption text-text-3 mb-1">Tool calls</h4>
          <ToolCallList toolCalls={toolCalls} />
        </div>
      )}
      {stopReason && <p className="u-caption text-text-3">stop: {stopReason}</p>}
      {!text && !toolCalls && (
        <pre className="u-caption bg-tile border border-hairline p-3 rounded overflow-auto text-text-2">
          {JSON.stringify(output, null, 2)}
        </pre>
      )}
    </div>
  )
}
```

### Step 5: Replace `ToolExecutionsSection.tsx`

```tsx
import { Wrench } from 'lucide-react'
import type { Round } from '../../types/round'
import { findEvent } from '../../lib/step-helpers'

interface Props {
  round: Round
}

export function ToolExecutionsSection({ round }: Props) {
  if (round.toolExecutions.length === 0) {
    return <p className="u-body text-text-3">(no tool executions)</p>
  }
  return (
    <ul className="space-y-4">
      {round.toolExecutions.map((t) => {
        const input = findEvent(t, 'argus.input')?.attributes ?? {}
        const output = findEvent(t, 'argus.output')?.attributes
        const toolName = t.componentName ?? t.name
        return (
          <li key={t.id} className="border border-hairline rounded p-2 space-y-2">
            <div className="flex items-center gap-2 u-body">
              <Wrench className="h-4 w-4 text-text-3" strokeWidth={1.75} />
              <span className="font-mono text-text-1">{toolName}</span>
            </div>
            <div>
              <p className="u-caption text-text-3 mb-1">Input</p>
              <pre className="u-caption bg-tile border border-hairline p-2 rounded overflow-auto text-text-2">
                {JSON.stringify(input, null, 2)}
              </pre>
            </div>
            <div>
              <p className="u-caption text-text-3 mb-1">Output</p>
              {output ? (
                <pre className="u-caption bg-tint-success p-2 rounded overflow-auto text-text-1">
                  {JSON.stringify(output, null, 2)}
                </pre>
              ) : (
                <p className="u-caption text-text-4">(no output)</p>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
```

### Step 6: Replace `RawSection.tsx`

```tsx
import type { Round } from '../../types/round'

interface Props {
  round: Round
}

export function RawSection({ round }: Props) {
  const payload = {
    id: round.id,
    trigger: round.trigger,
    llmCall: round.llmCall,
    toolExecutions: round.toolExecutions,
  }
  return (
    <pre className="u-caption bg-tile border border-hairline p-3 rounded overflow-auto text-text-2">
      {JSON.stringify(payload, null, 2)}
    </pre>
  )
}
```

### Step 7: Typecheck + build

```bash
pnpm --filter @argus/web typecheck
pnpm --filter @argus/web build
```

Expected: 0 errors.

### Step 8: Commit

```bash
git add apps/web/src/features/session-replay/detail/sections
git commit -m "feat(web): re-theme round detail sections to UniFi tokens"
```

---

## Task 6: Re-theme RoundHeader + RoundDetail + SessionTopbar

**Files:**

- Modify: `apps/web/src/features/session-replay/detail/RoundHeader.tsx` (full replace)
- Modify: `apps/web/src/features/session-replay/detail/RoundDetail.tsx` (full replace)
- Modify: `apps/web/src/features/session-replay/topbar/SessionTopbar.tsx` (full replace)

### Step 1: Replace `RoundHeader.tsx`

```tsx
import type { Round } from '../types/round'
import { Badge } from '@/components/ui/badge'
import { durationMs, formatDuration, tokenUsage } from '../lib/step-helpers'

interface Props {
  round: Round
  index: number
  total: number
}

function statusVariant(code: string) {
  if (code === 'OK') return 'default' as const
  if (code === 'ERROR') return 'destructive' as const
  return 'secondary' as const
}

export function RoundHeader({ round, index, total }: Props) {
  const tokens = tokenUsage(round.llmCall)
  const model = String(
    round.llmCall.attributes['gen_ai.request.model'] ?? round.llmCall.componentName ?? '',
  )
  return (
    <div className="space-y-2 pb-3 border-b border-hairline">
      <div className="flex items-baseline justify-between gap-3 min-w-0">
        <h3 className="u-h-lg text-text-1 truncate">
          Round {index + 1} / {total}
        </h3>
        <span className="u-caption font-mono text-text-4 shrink-0 tabular">
          {round.llmCall.spanId.slice(0, 12)}
        </span>
      </div>
      <div className="flex flex-wrap gap-2 items-center u-caption text-text-3">
        <Badge variant={statusVariant(round.llmCall.statusCode)}>{round.llmCall.statusCode}</Badge>
        <span className="tabular">{formatDuration(durationMs(round.llmCall))}</span>
        {model && <span>· {model}</span>}
        {tokens && (
          <span className="tabular">
            · tokens {tokens.input}/{tokens.output}
          </span>
        )}
        {round.toolExecutions.length > 0 && (
          <span className="tabular">· {round.toolExecutions.length} tool exec</span>
        )}
      </div>
    </div>
  )
}
```

### Step 2: Replace `RoundDetail.tsx`

Section headers use `u-h-md text-text-1`. Collapsible chevron + label use `text-text-3 hover:text-text-1`.

```tsx
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { Round } from '../types/round'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { RoundHeader } from './RoundHeader'
import { ContextSection } from './sections/ContextSection'
import { TriggerSection } from './sections/TriggerSection'
import { LlmResponseSection } from './sections/LlmResponseSection'
import { ToolExecutionsSection } from './sections/ToolExecutionsSection'
import { RawSection } from './sections/RawSection'

interface Props {
  round: Round
  index: number
  total: number
}

function SectionHeader({ icon, title }: { icon: string; title: string }) {
  return (
    <h4 className="u-h-md text-text-1 flex items-center gap-2 mb-2">
      <span aria-hidden="true">{icon}</span>
      <span>{title}</span>
    </h4>
  )
}

function CollapsibleSectionHeader({ icon, title }: { icon: string; title: string }) {
  return (
    <h4 className="u-h-md flex items-center gap-2 cursor-pointer select-none text-text-3 hover:text-text-1 transition-colors group">
      <ChevronRight className="h-4 w-4 group-data-[state=open]:hidden" />
      <ChevronDown className="h-4 w-4 hidden group-data-[state=open]:block" />
      <span aria-hidden="true">{icon}</span>
      <span>{title}</span>
    </h4>
  )
}

export function RoundDetail({ round, index, total }: Props) {
  return (
    <div className="h-full overflow-auto p-4 space-y-5">
      <RoundHeader round={round} index={index} total={total} />

      <Collapsible defaultOpen={false} className="group">
        <CollapsibleTrigger asChild>
          <button type="button" className="w-full text-left">
            <CollapsibleSectionHeader icon="📋" title="Context" />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2">
          <ContextSection round={round} />
        </CollapsibleContent>
      </Collapsible>

      <section>
        <SectionHeader icon="⚡" title="Trigger" />
        <TriggerSection round={round} />
      </section>

      <section>
        <SectionHeader icon="🧠" title="LLM Response" />
        <LlmResponseSection round={round} />
      </section>

      {round.toolExecutions.length > 0 && (
        <section>
          <SectionHeader icon="🔧" title="Tool execution" />
          <ToolExecutionsSection round={round} />
        </section>
      )}

      <Collapsible defaultOpen={false} className="group">
        <CollapsibleTrigger asChild>
          <button type="button" className="w-full text-left">
            <CollapsibleSectionHeader icon="🗂️" title="Raw" />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2">
          <RawSection round={round} />
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
```

> NOTE: the chevron now flips via Radix's `data-[state=open]` on the Collapsible root. The `group` class is on `<Collapsible>` and Radix sets `data-state` on that same element, so `group-data-[state=open]:` works. This removes the need for the `open` boolean prop the old header took.

### Step 3: Replace `SessionTopbar.tsx`

```tsx
import { ArrowLeft } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import type { SessionSummary, Step } from '@argus/shared-types'
import { Badge } from '@/components/ui/badge'
import {
  formatDuration,
  sessionDurationMs,
  sessionStatus,
  sessionTokens,
} from '../lib/step-helpers'

interface Props {
  session: SessionSummary
  steps: Step[]
  connected: boolean
}

function statusVariant(s: 'OK' | 'ERROR' | 'UNSET') {
  if (s === 'OK') return 'default' as const
  if (s === 'ERROR') return 'destructive' as const
  return 'secondary' as const
}

function LiveDot({ active }: { active: boolean }) {
  return (
    <span
      title={active ? 'Streaming live' : 'Not connected'}
      className="inline-flex items-center gap-1 u-caption"
    >
      <span
        className={
          active
            ? 'inline-block h-1.5 w-1.5 rounded-pill bg-success animate-pulse'
            : 'inline-block h-1.5 w-1.5 rounded-pill bg-text-4'
        }
      />
      <span className={active ? 'text-success' : 'text-text-4'}>{active ? 'LIVE' : 'offline'}</span>
    </span>
  )
}

export function SessionTopbar({ session, steps, connected }: Props) {
  const duration = sessionDurationMs(steps)
  const status = sessionStatus(steps)
  const tokens = sessionTokens(steps)
  return (
    <div className="border-b border-hairline px-6 py-2.5 flex items-center gap-4">
      <Link
        to="/sessions"
        className="text-text-3 hover:text-text-1 transition-colors"
        aria-label="Back to sessions"
      >
        <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
      </Link>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="u-h-lg text-text-1 truncate">
            {session.projectName} / {session.serviceName}
          </h2>
          <Badge variant={statusVariant(status)}>{status}</Badge>
          <LiveDot active={connected} />
        </div>
        <p className="u-caption font-mono text-text-4 truncate tabular">{session.traceId}</p>
      </div>
      <div className="u-caption text-text-3 flex items-center gap-3 shrink-0 tabular">
        <span>{formatDuration(duration)}</span>
        {(tokens.input > 0 || tokens.output > 0) && (
          <span>
            tokens {tokens.input}/{tokens.output}
          </span>
        )}
        <span>{steps.length} steps</span>
      </div>
    </div>
  )
}
```

### Step 4: Typecheck + build

```bash
pnpm --filter @argus/web typecheck
pnpm --filter @argus/web build
```

### Step 5: Commit

```bash
git add apps/web/src/features/session-replay/detail/RoundHeader.tsx \
        apps/web/src/features/session-replay/detail/RoundDetail.tsx \
        apps/web/src/features/session-replay/topbar/SessionTopbar.tsx
git commit -m "feat(web): re-theme round header/detail/topbar to UniFi tokens"
```

---

## Task 7: Re-theme auth + tokens pages

**Files:**

- Modify: `apps/web/src/routes/login.tsx` (full replace)
- Modify: `apps/web/src/routes/register.tsx` (full replace)
- Modify: `apps/web/src/routes/settings/tokens.tsx` (full replace)

Shared form-input class for this task:
`h-8 w-full rounded border border-hairline px-3 u-body text-text-1 bg-page focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-1`

### Step 1: Replace `login.tsx`

```tsx
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useAuth } from '../lib/auth-provider'

export const Route = createFileRoute('/login')({
  component: LoginPage,
})

function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await login(email, password)
      void navigate({ to: '/sessions' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-page">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-4 border border-hairline rounded p-6"
      >
        <h1 className="u-h-xl text-text-1">Sign in to Argus</h1>
        <label className="block space-y-1">
          <span className="u-caption text-text-3">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="h-8 w-full rounded border border-hairline px-3 u-body text-text-1 bg-page focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-1"
          />
        </label>
        <label className="block space-y-1">
          <span className="u-caption text-text-3">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className="h-8 w-full rounded border border-hairline px-3 u-body text-text-1 bg-page focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-1"
          />
        </label>
        {error && <p className="u-caption text-danger">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full h-8 rounded bg-brand text-white u-body hover:bg-brand-hover transition-colors disabled:opacity-50"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="u-caption text-text-3 text-center">
          No account?{' '}
          <Link to="/register" className="text-brand hover:text-brand-hover">
            Register
          </Link>
        </p>
      </form>
    </div>
  )
}
```

### Step 2: Replace `register.tsx`

```tsx
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useAuth } from '../lib/auth-provider'

export const Route = createFileRoute('/register')({
  component: RegisterPage,
})

function RegisterPage() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await register(email, password)
      void navigate({ to: '/sessions' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-page">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-4 border border-hairline rounded p-6"
      >
        <h1 className="u-h-xl text-text-1">Create your Argus account</h1>
        <label className="block space-y-1">
          <span className="u-caption text-text-3">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="h-8 w-full rounded border border-hairline px-3 u-body text-text-1 bg-page focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-1"
          />
        </label>
        <label className="block space-y-1">
          <span className="u-caption text-text-3">Password (min 8 chars)</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className="h-8 w-full rounded border border-hairline px-3 u-body text-text-1 bg-page focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-1"
          />
        </label>
        {error && <p className="u-caption text-danger">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full h-8 rounded bg-brand text-white u-body hover:bg-brand-hover transition-colors disabled:opacity-50"
        >
          {submitting ? 'Creating…' : 'Create account'}
        </button>
        <p className="u-caption text-text-3 text-center">
          Already have one?{' '}
          <Link to="/login" className="text-brand hover:text-brand-hover">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  )
}
```

### Step 3: Replace `settings/tokens.tsx`

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  createToken,
  listTokens,
  revokeToken,
  type CreatedToken,
  type TokenRecord,
} from '../../lib/api'
import { Badge } from '@/components/ui/badge'

export const Route = createFileRoute('/settings/tokens')({
  component: TokensPage,
})

const inputClass =
  'h-8 w-full rounded border border-hairline px-3 u-body text-text-1 bg-page focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-1'

function TokensPage() {
  const queryClient = useQueryClient()
  const { data, isLoading, error } = useQuery({
    queryKey: ['tokens'],
    queryFn: listTokens,
    retry: false,
  })
  const [revealed, setRevealed] = useState<CreatedToken | null>(null)
  const [projectName, setProjectName] = useState('')
  const [tokenName, setTokenName] = useState('')

  const create = useMutation({
    mutationFn: () => createToken({ projectName, tokenName }),
    onSuccess: (data) => {
      setRevealed(data)
      setProjectName('')
      setTokenName('')
      void queryClient.invalidateQueries({ queryKey: ['tokens'] })
    },
  })

  const revoke = useMutation({
    mutationFn: (id: string) => revokeToken(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tokens'] })
    },
  })

  if (isLoading) return <p className="p-6 u-body text-text-3">Loading…</p>
  if (error) return <p className="p-6 u-body text-danger">Error: {String(error)}</p>

  return (
    <div className="p-6 space-y-6 overflow-auto h-full">
      <header>
        <h2 className="u-h-lg text-text-1">Ingest tokens</h2>
        <p className="u-body text-text-3 mt-1">
          Use a token in the{' '}
          <code className="bg-tile px-1 rounded text-text-2">Authorization: Bearer</code> header
          when POSTing to <code className="bg-tile px-1 rounded text-text-2">/v1/traces</code>. The
          token&apos;s project determines where the traces land.
        </p>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (projectName && tokenName) create.mutate()
        }}
        className="border border-hairline rounded p-3 space-y-3 max-w-xl"
      >
        <h3 className="u-h-md text-text-1">Create a new token</h3>
        <label className="block space-y-1">
          <span className="u-caption text-text-3">Project name</span>
          <input
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="e.g. customer-bot"
            required
            className={inputClass}
          />
        </label>
        <label className="block space-y-1">
          <span className="u-caption text-text-3">Token name</span>
          <input
            value={tokenName}
            onChange={(e) => setTokenName(e.target.value)}
            placeholder="e.g. production"
            required
            className={inputClass}
          />
        </label>
        <button
          type="submit"
          disabled={create.isPending}
          className="h-8 px-4 rounded bg-brand text-white u-body hover:bg-brand-hover transition-colors disabled:opacity-50"
        >
          {create.isPending ? 'Creating…' : 'Create token'}
        </button>
        {create.error && <p className="u-caption text-danger">{String(create.error)}</p>}
      </form>

      {revealed && (
        <div className="border border-hairline rounded p-3 space-y-2 max-w-xl">
          <p className="u-h-md text-warning">Save this token now — it will not be shown again.</p>
          <pre className="u-caption bg-tile border border-hairline p-2 rounded break-all text-text-1">
            {revealed.token}
          </pre>
          <button
            type="button"
            onClick={() => setRevealed(null)}
            className="u-caption text-text-3 hover:text-text-1 underline"
          >
            I&apos;ve saved it
          </button>
        </div>
      )}

      <section>
        <h3 className="u-h-md text-text-1 mb-2">Existing tokens</h3>
        {data && data.length === 0 && <p className="u-body text-text-3">(no tokens yet)</p>}
        {data && data.length > 0 && (
          <div className="border border-hairline rounded">
            <table className="w-full u-body">
              <thead>
                <tr className="text-left u-caption text-text-3 border-b border-hairline">
                  <th className="font-normal px-3 py-2">Project</th>
                  <th className="font-normal px-3 py-2">Name</th>
                  <th className="font-normal px-3 py-2">Prefix</th>
                  <th className="font-normal px-3 py-2">Created</th>
                  <th className="font-normal px-3 py-2">Status</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {data.map((t: TokenRecord) => (
                  <tr key={t.id} className="border-b border-hairline last:border-0">
                    <td className="px-3 py-2 text-text-1">{t.projectName}</td>
                    <td className="px-3 py-2 text-text-2">{t.name}</td>
                    <td className="px-3 py-2 font-mono u-caption text-text-3 tabular">
                      {t.prefix}…
                    </td>
                    <td className="px-3 py-2 text-text-3 tabular">
                      {new Date(t.createdAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">
                      {t.revokedAt ? (
                        <Badge variant="secondary">revoked</Badge>
                      ) : (
                        <Badge variant="default">active</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {!t.revokedAt && (
                        <button
                          type="button"
                          onClick={() => revoke.mutate(t.id)}
                          className="u-caption text-danger hover:underline"
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
```

### Step 4: Typecheck + build

```bash
pnpm --filter @argus/web typecheck
pnpm --filter @argus/web build
```

### Step 5: Commit

```bash
git add apps/web/src/routes/login.tsx apps/web/src/routes/register.tsx apps/web/src/routes/settings/tokens.tsx
git commit -m "feat(web): re-theme auth + tokens pages to UniFi tokens"
```

---

## Task 8: Full pipeline + automated checks (visual review done separately by controller)

No code changes. Verification of the build/test pipeline. The **visual** verification (screenshots compared against DESIGN.md) is performed by the controller in the main loop using Claude Preview — NOT by this subagent (a subagent's screenshot doesn't reach the human).

### Step 1: Clean install + pipeline

```bash
rm -rf node_modules apps/*/node_modules packages/*/node_modules
pnpm install
pnpm db:up
sleep 5
pnpm typecheck
pnpm lint
pnpm test
pnpm db:down
pnpm build
```

Expected: all exit 0. Test counts unchanged from M4 (78 total: 64 server + 14 web) — M5a is visual-only, no test changes.

### Step 2: Confirm no raw palette classes remain in re-themed files

```bash
grep -rEn "neutral-[0-9]|blue-[0-9]|amber-[0-9]|emerald-[0-9]|green-[0-9]|red-[0-9]|bg-white|text-black" \
  apps/web/src/routes apps/web/src/features apps/web/src/components/ui \
  || echo "CLEAN: no raw palette classes remain"
```

Expected: `CLEAN: no raw palette classes remain`. If any hits appear, they are leftovers — re-theme them using the cheat sheet, re-run, then continue. (The only acceptable hits would be inside comments; if so, note them.)

### Step 3: Report for controller hand-off

Report DONE with:

- pipeline result (typecheck/lint/test/build)
- grep result (clean or list of leftovers)
- the list of all commits in this plan (`git log --oneline` since the plan commit)

Do NOT tag. The controller will do visual review via Claude Preview, then tag `m5a-unifi-visual` after confirming the look.

---

## Acceptance Summary

M5a is complete when:

- [ ] `pnpm install` / `typecheck` / `lint` / `test` / `build` all exit 0
- [ ] 78 tests still pass (visual-only milestone, no test changes)
- [ ] No raw `neutral-*` / `blue-*` / `amber-*` / `green-*` / `red-*` / `bg-white` / `text-black` classes remain in `routes`, `features`, `components/ui`
- [ ] `index.css` defines all DESIGN.md tokens (light + dark) and `.u-*` + `.tabular`
- [ ] Inter is loaded via `@fontsource-variable/inter`
- [ ] **(Controller, via Claude Preview)** Sessions list, session replay (timeline + round detail), login, and tokens pages visually match DESIGN.md: transparent hairline cards, 4px radii, tight 12/8 padding, 13px Inter body, brand-blue links, status pills as tints, no shadows on cards
- [ ] Tag `m5a-unifi-visual` pushed (by controller after visual sign-off); CI green

Once this lands, **M5b (gRPC ingest)** and the backlog items (`docs/superpowers/...` + memory `project_backlog`) remain.
