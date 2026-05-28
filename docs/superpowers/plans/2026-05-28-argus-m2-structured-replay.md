# Argus M2 — Structured Replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the raw-JSON session detail page with the structured replay UX: a virtualized left-side step timeline + a right-side detail panel that has Input / Output / Raw / Events tabs and dispatches to a Renderer registered for the step's kind.

**Architecture:** New `apps/web/src/features/session-replay/` feature folder owns the layout, timeline, detail, renderers, and helpers. Renderer registration is static (an array of `StepRenderer` objects in `renderers/registry.ts`) with `match(step) -> number` priority — `GenericJsonRenderer` is the always-matching fallback at priority 1; specialized renderers (User / Assistant / LLM / Tool) match at priority 10+. URL search params (`?step=<id>&tab=input`) hold the navigation state, validated by Zod in the route definition.

**Tech Stack additions on top of M1:** shadcn/ui components (tabs, badge, separator, scroll-area), `@tanstack/react-virtual`. No new server work.

**Scope deliberately excluded** (later milestones):

- ExternalResource renderer (later, when external-resource spans exist)
- Tree / parent-child indentation in timeline (later if needed; M2 keeps flat)
- Live updates via SSE (M3)
- Search / filter within timeline (later)

**Reference spec:** [docs/superpowers/specs/2026-05-28-argus-design.md](../specs/2026-05-28-argus-design.md)

---

## File Structure (after M2)

```
apps/web/src/
├── routes/
│   ├── __root.tsx                                (modified: remove p-6 from main, allow full-height children)
│   ├── sessions.tsx                              (unchanged: just renders <Outlet />)
│   └── sessions/
│       ├── index.tsx                             (modified: add inner p-6 wrapper)
│       └── $sessionId.tsx                        (rewritten: validateSearch + delegate to SessionReplay)
├── routeTree.gen.ts                              (regenerated after route changes)
├── components/ui/                                (new: shadcn-installed)
│   ├── tabs.tsx
│   ├── badge.tsx
│   ├── separator.tsx
│   └── scroll-area.tsx                           (only if used; ok to skip)
├── lib/
│   └── utils.ts                                  (new: cn helper, installed by shadcn)
└── features/
    └── session-replay/
        ├── index.tsx                             (SessionReplay layout entry)
        ├── lib/
        │   ├── step-helpers.ts                   (findEvent, durationMs, formatDuration, tokenUsage, etc.)
        │   └── step-helpers.test.ts
        ├── renderers/
        │   ├── types.ts                          (StepRenderer interface)
        │   ├── registry.ts                       (renderers[] + findRenderer)
        │   ├── registry.test.ts
        │   ├── generic-json.tsx                  (fallback renderer)
        │   ├── user-message.tsx
        │   ├── assistant-message.tsx
        │   ├── llm-call.tsx
        │   └── tool-call.tsx
        ├── timeline/
        │   ├── StepTimeline.tsx                  (virtualized list)
        │   ├── StepRow.tsx                       (one row)
        │   └── step-icons.ts                     (kind → lucide icon)
        ├── detail/
        │   ├── StepDetail.tsx                    (tabs container)
        │   ├── StepMetaHeader.tsx                (top of detail panel)
        │   ├── EventsTab.tsx
        │   └── RawTab.tsx
        └── topbar/
            └── SessionTopbar.tsx
```

---

## Common Conventions

- All imports use the `@/` alias where helpful (apps/web's `paths` already maps `@/*` → `./src/*`).
- Tailwind classes are mostly neutrals + a couple of accent colors. No `dark:` variants — light mode only (M2 baseline; theming arrives via DESIGN.md in M5).
- All files end with a newline; lint-staged will normalize.
- Commit messages: Conventional Commits, lowercase subject after the colon (commitlint enforces).

---

## Task 1: Install M2 deps (shadcn components + @tanstack/react-virtual)

**Files:**

- Modify: `apps/web/package.json` (deps added)
- Auto-created by shadcn: `apps/web/components.json` (already exists from M0), `apps/web/src/lib/utils.ts`, `apps/web/src/components/ui/{tabs,badge,separator}.tsx`

- [ ] **Step 1: Add `@tanstack/react-virtual` to `apps/web/package.json`** dependencies. Replace the file with:

```json
{
  "name": "@argus/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run --passWithNoTests",
    "lint": "eslint src",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@argus/shared-types": "workspace:*",
    "@tanstack/react-query": "^5.50.0",
    "@tanstack/react-router": "^1.60.0",
    "@tanstack/react-virtual": "^3.10.0",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.0",
    "lucide-react": "^0.460.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "tailwind-merge": "^2.5.0",
    "@radix-ui/react-tabs": "^1.1.0",
    "@radix-ui/react-separator": "^1.1.0"
  },
  "devDependencies": {
    "@argus/eslint-config": "workspace:*",
    "@argus/tsconfig": "workspace:*",
    "@tailwindcss/vite": "^4.0.0",
    "@tanstack/router-devtools": "^1.60.0",
    "@tanstack/router-plugin": "^1.60.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.0.0",
    "eslint": "^9.0.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.6.0",
    "vite": "^6.0.0",
    "vitest": "^2.0.0"
  }
}
```

(We list `@radix-ui/react-tabs` and `@radix-ui/react-separator` directly so the shadcn-added component files compile out of the box even before `shadcn add` runs in Step 3. `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react` are shadcn's standard runtime deps.)

- [ ] **Step 2: Install**

```bash
pnpm install
```

- [ ] **Step 3: Create `apps/web/src/lib/utils.ts`** (shadcn's standard cn helper; if shadcn's CLI is used later it won't overwrite):

```ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

- [ ] **Step 4: Create `apps/web/src/components/ui/tabs.tsx`** (verbatim shadcn flat-config, hand-written here so we don't depend on `shadcn add` running cleanly):

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
      'inline-flex h-9 items-center justify-center rounded-lg bg-neutral-100 p-1 text-neutral-500',
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
      'inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium transition-all',
      'data-[state=active]:bg-white data-[state=active]:text-neutral-900 data-[state=active]:shadow',
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

- [ ] **Step 5: Create `apps/web/src/components/ui/badge.tsx`**

```tsx
import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-neutral-900 text-neutral-50',
        secondary: 'border-transparent bg-neutral-100 text-neutral-900',
        destructive: 'border-transparent bg-red-600 text-white',
        outline: 'text-neutral-900',
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

- [ ] **Step 6: Create `apps/web/src/components/ui/separator.tsx`**

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
      'shrink-0 bg-neutral-200',
      orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
      className,
    )}
    {...props}
  />
))
Separator.displayName = SeparatorPrimitive.Root.displayName

export { Separator }
```

- [ ] **Step 7: Verify build**

```bash
pnpm --filter @argus/web typecheck
pnpm --filter @argus/web build
```

Expected: 0 errors; `dist/index.html` produced.

- [ ] **Step 8: Commit**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat(web): add shadcn tabs/badge/separator + tanstack-virtual + utils"
```

---

## Task 2: Step helpers + tests

**Files:**

- Create: `apps/web/src/features/session-replay/lib/step-helpers.ts`
- Create: `apps/web/src/features/session-replay/lib/step-helpers.test.ts`

- [ ] **Step 1: Write the failing test `step-helpers.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import type { Step } from '@argus/shared-types'
import {
  durationMs,
  findEvent,
  formatDuration,
  sessionDurationMs,
  sessionStatus,
  sessionTokens,
  tokenUsage,
} from './step-helpers'

function makeStep(overrides: Partial<Step> = {}): Step {
  return {
    id: 'x',
    spanId: 'a'.repeat(16),
    parentSpanId: null,
    name: 'test',
    kind: null,
    componentType: null,
    componentName: null,
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: '2026-01-01T00:00:01.500Z',
    attributes: {},
    statusCode: 'OK',
    statusMessage: null,
    events: [],
    ...overrides,
  }
}

describe('step-helpers', () => {
  it('findEvent returns the matching event or undefined', () => {
    const step = makeStep({
      events: [
        { id: 'e1', name: 'argus.input', ts: '2026-01-01T00:00:00.5Z', attributes: { x: 1 } },
      ],
    })
    expect(findEvent(step, 'argus.input')?.attributes).toEqual({ x: 1 })
    expect(findEvent(step, 'argus.output')).toBeUndefined()
  })

  it('durationMs computes endedAt - startedAt in ms', () => {
    expect(durationMs(makeStep())).toBe(1500)
  })

  it('formatDuration produces ms / s / m s output', () => {
    expect(formatDuration(45)).toBe('45ms')
    expect(formatDuration(1500)).toBe('1.50s')
    expect(formatDuration(75_000)).toBe('1m 15s')
  })

  it('tokenUsage reads gen_ai.usage attributes or returns null', () => {
    expect(tokenUsage(makeStep())).toBeNull()
    const step = makeStep({
      attributes: { 'gen_ai.usage.input_tokens': 100, 'gen_ai.usage.output_tokens': 40 },
    })
    expect(tokenUsage(step)).toEqual({ input: 100, output: 40 })
  })

  it('sessionTokens sums across steps', () => {
    const s1 = makeStep({
      attributes: { 'gen_ai.usage.input_tokens': 10, 'gen_ai.usage.output_tokens': 5 },
    })
    const s2 = makeStep({
      attributes: { 'gen_ai.usage.input_tokens': 20, 'gen_ai.usage.output_tokens': 8 },
    })
    expect(sessionTokens([s1, s2, makeStep()])).toEqual({ input: 30, output: 13 })
  })

  it('sessionDurationMs covers earliest startedAt to latest endedAt', () => {
    const a = makeStep({ startedAt: '2026-01-01T00:00:00Z', endedAt: '2026-01-01T00:00:01Z' })
    const b = makeStep({ startedAt: '2026-01-01T00:00:02Z', endedAt: '2026-01-01T00:00:05Z' })
    expect(sessionDurationMs([a, b])).toBe(5000)
    expect(sessionDurationMs([])).toBe(0)
  })

  it('sessionStatus is ERROR if any step is ERROR, OK if all OK, otherwise UNSET', () => {
    expect(sessionStatus([makeStep({ statusCode: 'OK' })])).toBe('OK')
    expect(sessionStatus([makeStep({ statusCode: 'OK' }), makeStep({ statusCode: 'ERROR' })])).toBe(
      'ERROR',
    )
    expect(sessionStatus([makeStep({ statusCode: 'UNSET' })])).toBe('UNSET')
  })
})
```

- [ ] **Step 2: Run the test, confirm it FAILS** (module doesn't exist).

```bash
pnpm --filter @argus/web test
```

Expected: FAIL, "Failed to resolve import './step-helpers'" or similar.

- [ ] **Step 3: Create `step-helpers.ts`**

```ts
import type { Step, StepEvent } from '@argus/shared-types'

export function findEvent(step: Step, name: string): StepEvent | undefined {
  return step.events.find((e) => e.name === name)
}

export function durationMs(step: Step): number {
  return new Date(step.endedAt).getTime() - new Date(step.startedAt).getTime()
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.floor((ms % 60_000) / 1000)
  return `${minutes}m ${seconds}s`
}

export function tokenUsage(step: Step): { input: number; output: number } | null {
  const attrs = step.attributes
  const input = attrs['gen_ai.usage.input_tokens']
  const output = attrs['gen_ai.usage.output_tokens']
  if (typeof input !== 'number' && typeof output !== 'number') return null
  return {
    input: typeof input === 'number' ? input : 0,
    output: typeof output === 'number' ? output : 0,
  }
}

export function sessionTokens(steps: Step[]): { input: number; output: number } {
  let input = 0
  let output = 0
  for (const step of steps) {
    const t = tokenUsage(step)
    if (t) {
      input += t.input
      output += t.output
    }
  }
  return { input, output }
}

export function sessionDurationMs(steps: Step[]): number {
  if (steps.length === 0) return 0
  let start = Infinity
  let end = -Infinity
  for (const s of steps) {
    const sMs = new Date(s.startedAt).getTime()
    const eMs = new Date(s.endedAt).getTime()
    if (sMs < start) start = sMs
    if (eMs > end) end = eMs
  }
  return end - start
}

export function sessionStatus(steps: Step[]): 'OK' | 'ERROR' | 'UNSET' {
  if (steps.some((s) => s.statusCode === 'ERROR')) return 'ERROR'
  if (steps.every((s) => s.statusCode === 'OK')) return 'OK'
  return 'UNSET'
}
```

- [ ] **Step 4: Run the test, confirm it PASSES**

```bash
pnpm --filter @argus/web test
```

Expected: PASS — 7 tests in `step-helpers.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/session-replay/lib
git commit -m "feat(web): session-replay step helpers + tests"
```

---

## Task 3: Renderer types + registry + GenericJsonRenderer + tests

**Files:**

- Create: `apps/web/src/features/session-replay/renderers/types.ts`
- Create: `apps/web/src/features/session-replay/renderers/registry.ts`
- Create: `apps/web/src/features/session-replay/renderers/generic-json.tsx`
- Create: `apps/web/src/features/session-replay/renderers/registry.test.ts`

- [ ] **Step 1: Create `renderers/types.ts`**

```ts
import type { ReactNode } from 'react'
import type { Step } from '@argus/shared-types'

export interface StepRenderer {
  /** Unique identifier for the renderer (used by tests; not user-visible). */
  id: string
  /** Higher number wins. Return 0 to opt out. */
  match: (step: Step) => number
  /** Content for the Input tab. */
  renderInput?: (step: Step) => ReactNode
  /** Content for the Output tab. */
  renderOutput?: (step: Step) => ReactNode
}
```

- [ ] **Step 2: Create `renderers/generic-json.tsx`**

```tsx
import type { StepRenderer } from './types'
import { findEvent } from '../lib/step-helpers'

function JsonView({ data }: { data: unknown }) {
  return (
    <pre className="text-xs bg-neutral-50 border border-neutral-200 p-3 rounded overflow-auto">
      {JSON.stringify(data, null, 2)}
    </pre>
  )
}

export const GenericJsonRenderer: StepRenderer = {
  id: 'generic-json',
  match: () => 1,
  renderInput: (step) => {
    const input = findEvent(step, 'argus.input')
    return input ? (
      <JsonView data={input.attributes} />
    ) : (
      <p className="text-neutral-500 text-sm">(no input)</p>
    )
  },
  renderOutput: (step) => {
    const output = findEvent(step, 'argus.output')
    return output ? (
      <JsonView data={output.attributes} />
    ) : (
      <p className="text-neutral-500 text-sm">(no output)</p>
    )
  },
}
```

- [ ] **Step 3: Create `renderers/registry.ts`**

```ts
import type { Step } from '@argus/shared-types'
import type { StepRenderer } from './types'
import { GenericJsonRenderer } from './generic-json'

/**
 * Registered renderers, ordered by registration but resolved by priority.
 * Specialized renderers append themselves here in tasks M2-4..M2-7.
 */
export const renderers: StepRenderer[] = [GenericJsonRenderer]

export function registerRenderer(r: StepRenderer): void {
  renderers.push(r)
}

export function findRenderer(step: Step): StepRenderer {
  let best: StepRenderer = GenericJsonRenderer
  let bestPriority = best.match(step)
  for (const r of renderers) {
    const p = r.match(step)
    if (p > bestPriority) {
      best = r
      bestPriority = p
    }
  }
  return best
}
```

- [ ] **Step 4: Write `renderers/registry.test.ts`** (TDD — test BEFORE adding more renderers)

```ts
import { describe, expect, it, beforeEach } from 'vitest'
import type { Step } from '@argus/shared-types'
import { findRenderer, registerRenderer, renderers } from './registry'
import { GenericJsonRenderer } from './generic-json'

function makeStep(overrides: Partial<Step> = {}): Step {
  return {
    id: 'x',
    spanId: 'a'.repeat(16),
    parentSpanId: null,
    name: 'test',
    kind: null,
    componentType: null,
    componentName: null,
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: '2026-01-01T00:00:01.000Z',
    attributes: {},
    statusCode: 'OK',
    statusMessage: null,
    events: [],
    ...overrides,
  }
}

describe('findRenderer', () => {
  // Snapshot the original registry so tests are isolated.
  const original = [...renderers]
  beforeEach(() => {
    renderers.length = 0
    renderers.push(...original)
  })

  it('falls back to GenericJsonRenderer when nothing matches', () => {
    expect(findRenderer(makeStep()).id).toBe('generic-json')
  })

  it('higher priority renderer wins', () => {
    registerRenderer({ id: 'high', match: () => 100 })
    expect(findRenderer(makeStep()).id).toBe('high')
  })

  it('zero-priority renderers are ignored', () => {
    registerRenderer({ id: 'zero', match: () => 0 })
    expect(findRenderer(makeStep()).id).toBe('generic-json')
  })

  it('per-step priority lets one renderer win for some steps and another for others', () => {
    registerRenderer({ id: 'user-only', match: (s) => (s.kind === 'user_message' ? 10 : 0) })
    expect(findRenderer(makeStep({ kind: 'user_message' })).id).toBe('user-only')
    expect(findRenderer(makeStep({ kind: 'assistant_message' })).id).toBe('generic-json')
  })

  it('GenericJsonRenderer always returns content for input/output (even when none)', () => {
    const step = makeStep()
    // Verify the renderer has both functions — no assertion that they return JSX without a DOM.
    expect(typeof GenericJsonRenderer.renderInput).toBe('function')
    expect(typeof GenericJsonRenderer.renderOutput).toBe('function')
  })
})
```

- [ ] **Step 5: Run the tests**

```bash
pnpm --filter @argus/web test
```

Expected: PASS — 5 new tests + 7 from Task 2 = 12 total in the web package.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/session-replay/renderers
git commit -m "feat(web): step renderer registry + generic-json fallback + tests"
```

---

## Task 4: UserMessageRenderer

**Files:**

- Create: `apps/web/src/features/session-replay/renderers/user-message.tsx`
- Modify: `apps/web/src/features/session-replay/renderers/registry.ts` (push UserMessageRenderer)

- [ ] **Step 1: Create `renderers/user-message.tsx`**

```tsx
import { User } from 'lucide-react'
import type { StepRenderer } from './types'
import { findEvent } from '../lib/step-helpers'

function MessageBubble({ text }: { text: string }) {
  return (
    <div className="flex gap-3 items-start">
      <div className="rounded-full bg-blue-100 p-2 shrink-0">
        <User className="h-4 w-4 text-blue-700" />
      </div>
      <div className="rounded-lg bg-blue-50 border border-blue-100 px-4 py-3 max-w-prose whitespace-pre-wrap text-sm">
        {text}
      </div>
    </div>
  )
}

export const UserMessageRenderer: StepRenderer = {
  id: 'user-message',
  match: (step) => (step.kind === 'user_message' ? 10 : 0),
  renderInput: (step) => {
    const input = findEvent(step, 'argus.input')
    const text = typeof input?.attributes.text === 'string' ? input.attributes.text : '(no text)'
    return <MessageBubble text={text} />
  },
  renderOutput: () => <p className="text-neutral-500 text-sm">(user messages have no output)</p>,
}
```

- [ ] **Step 2: Modify `registry.ts`** to register the new renderer. Replace the file with:

```ts
import type { Step } from '@argus/shared-types'
import type { StepRenderer } from './types'
import { GenericJsonRenderer } from './generic-json'
import { UserMessageRenderer } from './user-message'

export const renderers: StepRenderer[] = [GenericJsonRenderer, UserMessageRenderer]

export function registerRenderer(r: StepRenderer): void {
  renderers.push(r)
}

export function findRenderer(step: Step): StepRenderer {
  let best: StepRenderer = GenericJsonRenderer
  let bestPriority = best.match(step)
  for (const r of renderers) {
    const p = r.match(step)
    if (p > bestPriority) {
      best = r
      bestPriority = p
    }
  }
  return best
}
```

- [ ] **Step 3: Update `registry.test.ts`** to add a coverage test for the new renderer. Append inside the `describe('findRenderer', ...)` block:

```ts
it('picks UserMessageRenderer for user_message kind', () => {
  expect(findRenderer(makeStep({ kind: 'user_message' })).id).toBe('user-message')
})
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @argus/web test
```

Expected: PASS — 13 tests now.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/session-replay/renderers
git commit -m "feat(web): user-message renderer"
```

---

## Task 5: AssistantMessageRenderer

**Files:**

- Create: `apps/web/src/features/session-replay/renderers/assistant-message.tsx`
- Modify: `apps/web/src/features/session-replay/renderers/registry.ts`
- Modify: `apps/web/src/features/session-replay/renderers/registry.test.ts`

- [ ] **Step 1: Create `renderers/assistant-message.tsx`**

```tsx
import { Sparkles } from 'lucide-react'
import type { StepRenderer } from './types'
import { findEvent } from '../lib/step-helpers'

function AssistantBubble({ text, toolCalls }: { text?: string; toolCalls?: unknown[] }) {
  return (
    <div className="flex gap-3 items-start">
      <div className="rounded-full bg-amber-100 p-2 shrink-0">
        <Sparkles className="h-4 w-4 text-amber-700" />
      </div>
      <div className="space-y-2 flex-1 min-w-0">
        {text && (
          <div className="rounded-lg bg-amber-50 border border-amber-100 px-4 py-3 max-w-prose whitespace-pre-wrap text-sm">
            {text}
          </div>
        )}
        {toolCalls && toolCalls.length > 0 && (
          <div className="text-xs text-neutral-600">
            <p className="font-semibold mb-1 text-neutral-500 uppercase">Tool calls</p>
            <pre className="bg-neutral-50 border border-neutral-200 p-2 rounded overflow-auto">
              {JSON.stringify(toolCalls, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}

export const AssistantMessageRenderer: StepRenderer = {
  id: 'assistant-message',
  match: (step) => (step.kind === 'assistant_message' ? 10 : 0),
  renderInput: () => (
    <p className="text-neutral-500 text-sm">(input was the previous user message)</p>
  ),
  renderOutput: (step) => {
    const output = findEvent(step, 'argus.output')
    if (!output) return <p className="text-neutral-500 text-sm">(no output)</p>
    const attrs = output.attributes
    const text = typeof attrs.text === 'string' ? attrs.text : undefined
    const toolCalls = Array.isArray(attrs.tool_calls) ? attrs.tool_calls : undefined
    if (!text && !toolCalls) {
      return (
        <pre className="text-xs bg-neutral-50 border p-3 rounded overflow-auto">
          {JSON.stringify(attrs, null, 2)}
        </pre>
      )
    }
    return <AssistantBubble text={text} toolCalls={toolCalls} />
  },
}
```

- [ ] **Step 2: Modify `registry.ts`** — add AssistantMessageRenderer to the array.

```ts
import type { Step } from '@argus/shared-types'
import type { StepRenderer } from './types'
import { GenericJsonRenderer } from './generic-json'
import { UserMessageRenderer } from './user-message'
import { AssistantMessageRenderer } from './assistant-message'

export const renderers: StepRenderer[] = [
  GenericJsonRenderer,
  UserMessageRenderer,
  AssistantMessageRenderer,
]

export function registerRenderer(r: StepRenderer): void {
  renderers.push(r)
}

export function findRenderer(step: Step): StepRenderer {
  let best: StepRenderer = GenericJsonRenderer
  let bestPriority = best.match(step)
  for (const r of renderers) {
    const p = r.match(step)
    if (p > bestPriority) {
      best = r
      bestPriority = p
    }
  }
  return best
}
```

- [ ] **Step 3: Add coverage test** in `registry.test.ts`, inside the existing describe:

```ts
it('picks AssistantMessageRenderer for assistant_message kind', () => {
  expect(findRenderer(makeStep({ kind: 'assistant_message' })).id).toBe('assistant-message')
})
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @argus/web test
```

Expected: PASS — 14 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/session-replay/renderers
git commit -m "feat(web): assistant-message renderer"
```

---

## Task 6: LlmCallRenderer

**Files:**

- Create: `apps/web/src/features/session-replay/renderers/llm-call.tsx`
- Modify: `apps/web/src/features/session-replay/renderers/registry.ts`
- Modify: `apps/web/src/features/session-replay/renderers/registry.test.ts`

- [ ] **Step 1: Create `renderers/llm-call.tsx`**

```tsx
import type { Step } from '@argus/shared-types'
import type { StepRenderer } from './types'
import { findEvent, tokenUsage } from '../lib/step-helpers'

function ModelMeta({ step }: { step: Step }) {
  const attrs = step.attributes
  const model = attrs['gen_ai.request.model'] ?? step.componentName
  const tokens = tokenUsage(step)
  return (
    <div className="flex items-center gap-3 text-xs text-neutral-500">
      {typeof model === 'string' && <span className="font-mono">{model}</span>}
      {tokens && (
        <span>
          tokens: {tokens.input}/{tokens.output}
        </span>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-xs font-semibold text-neutral-500 uppercase mb-1">{title}</h4>
      {children}
    </div>
  )
}

export const LlmCallRenderer: StepRenderer = {
  id: 'llm-call',
  match: (step) => {
    if (step.kind === 'llm_call') return 20
    if (step.componentType === 'llm') return 15
    return 0
  },
  renderInput: (step) => {
    const input = findEvent(step, 'argus.input')
    const attrs = input?.attributes ?? {}
    const messages = Array.isArray(attrs.messages) ? attrs.messages : null
    const tools = Array.isArray(attrs.tools) ? attrs.tools : null
    const systemPrompt = typeof attrs.system_prompt === 'string' ? attrs.system_prompt : null

    if (!messages && !tools && !systemPrompt) {
      return (
        <div className="space-y-4">
          <ModelMeta step={step} />
          <pre className="text-xs bg-neutral-50 border p-3 rounded overflow-auto">
            {JSON.stringify(attrs, null, 2)}
          </pre>
        </div>
      )
    }

    return (
      <div className="space-y-4">
        <ModelMeta step={step} />
        {systemPrompt && (
          <Section title="System prompt">
            <pre className="text-sm bg-neutral-50 border p-3 rounded whitespace-pre-wrap">
              {systemPrompt}
            </pre>
          </Section>
        )}
        {messages && (
          <Section title="Messages">
            <ul className="space-y-2">
              {messages.map((m, i) => (
                <li key={i} className="border rounded p-2 text-sm">
                  <p className="text-xs text-neutral-500 mb-1">
                    {String((m as { role?: unknown }).role ?? 'unknown')}
                  </p>
                  <pre className="whitespace-pre-wrap">
                    {String((m as { content?: unknown }).content ?? '')}
                  </pre>
                </li>
              ))}
            </ul>
          </Section>
        )}
        {tools && (
          <Section title="Tools available">
            <pre className="text-xs bg-neutral-50 border p-2 rounded overflow-auto">
              {JSON.stringify(tools, null, 2)}
            </pre>
          </Section>
        )}
      </div>
    )
  },
  renderOutput: (step) => {
    const output = findEvent(step, 'argus.output')
    if (!output) return <p className="text-neutral-500 text-sm">(no output)</p>
    const attrs = output.attributes
    const text = typeof attrs.text === 'string' ? attrs.text : undefined
    const toolCalls = Array.isArray(attrs.tool_calls) ? attrs.tool_calls : undefined
    const stopReason = typeof attrs.stop_reason === 'string' ? attrs.stop_reason : undefined

    return (
      <div className="space-y-4">
        {text && (
          <Section title="Text">
            <pre className="text-sm bg-amber-50 border border-amber-100 p-3 rounded whitespace-pre-wrap">
              {text}
            </pre>
          </Section>
        )}
        {toolCalls && (
          <Section title="Tool calls">
            <pre className="text-xs bg-neutral-50 border p-2 rounded overflow-auto">
              {JSON.stringify(toolCalls, null, 2)}
            </pre>
          </Section>
        )}
        {stopReason && <p className="text-xs text-neutral-500">stop: {stopReason}</p>}
        {!text && !toolCalls && (
          <pre className="text-xs bg-neutral-50 border p-3 rounded overflow-auto">
            {JSON.stringify(attrs, null, 2)}
          </pre>
        )}
      </div>
    )
  },
}
```

- [ ] **Step 2: Modify `registry.ts`** to add LlmCallRenderer.

```ts
import type { Step } from '@argus/shared-types'
import type { StepRenderer } from './types'
import { GenericJsonRenderer } from './generic-json'
import { UserMessageRenderer } from './user-message'
import { AssistantMessageRenderer } from './assistant-message'
import { LlmCallRenderer } from './llm-call'

export const renderers: StepRenderer[] = [
  GenericJsonRenderer,
  UserMessageRenderer,
  AssistantMessageRenderer,
  LlmCallRenderer,
]

export function registerRenderer(r: StepRenderer): void {
  renderers.push(r)
}

export function findRenderer(step: Step): StepRenderer {
  let best: StepRenderer = GenericJsonRenderer
  let bestPriority = best.match(step)
  for (const r of renderers) {
    const p = r.match(step)
    if (p > bestPriority) {
      best = r
      bestPriority = p
    }
  }
  return best
}
```

- [ ] **Step 3: Add tests** inside `registry.test.ts`:

```ts
it('picks LlmCallRenderer for llm_call kind', () => {
  expect(findRenderer(makeStep({ kind: 'llm_call' })).id).toBe('llm-call')
})

it('picks LlmCallRenderer when componentType is llm (lower priority than kind)', () => {
  expect(findRenderer(makeStep({ componentType: 'llm' })).id).toBe('llm-call')
})
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @argus/web test
```

Expected: PASS — 16 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/session-replay/renderers
git commit -m "feat(web): llm-call renderer"
```

---

## Task 7: ToolCallRenderer

**Files:**

- Create: `apps/web/src/features/session-replay/renderers/tool-call.tsx`
- Modify: `apps/web/src/features/session-replay/renderers/registry.ts`
- Modify: `apps/web/src/features/session-replay/renderers/registry.test.ts`

- [ ] **Step 1: Create `renderers/tool-call.tsx`**

```tsx
import { Wrench } from 'lucide-react'
import type { StepRenderer } from './types'
import { findEvent } from '../lib/step-helpers'

export const ToolCallRenderer: StepRenderer = {
  id: 'tool-call',
  match: (step) => (step.kind === 'tool_call' ? 10 : 0),
  renderInput: (step) => {
    const input = findEvent(step, 'argus.input')
    const toolName = step.componentName ?? step.name
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm">
          <Wrench className="h-4 w-4 text-neutral-500" />
          <span className="font-mono">{toolName}</span>
        </div>
        <pre className="text-xs bg-neutral-50 border p-3 rounded overflow-auto">
          {JSON.stringify(input?.attributes ?? {}, null, 2)}
        </pre>
      </div>
    )
  },
  renderOutput: (step) => {
    const output = findEvent(step, 'argus.output')
    if (!output) return <p className="text-neutral-500 text-sm">(no output)</p>
    return (
      <pre className="text-xs bg-green-50 border border-green-100 p-3 rounded overflow-auto">
        {JSON.stringify(output.attributes, null, 2)}
      </pre>
    )
  },
}
```

- [ ] **Step 2: Modify `registry.ts`**

```ts
import type { Step } from '@argus/shared-types'
import type { StepRenderer } from './types'
import { GenericJsonRenderer } from './generic-json'
import { UserMessageRenderer } from './user-message'
import { AssistantMessageRenderer } from './assistant-message'
import { LlmCallRenderer } from './llm-call'
import { ToolCallRenderer } from './tool-call'

export const renderers: StepRenderer[] = [
  GenericJsonRenderer,
  UserMessageRenderer,
  AssistantMessageRenderer,
  LlmCallRenderer,
  ToolCallRenderer,
]

export function registerRenderer(r: StepRenderer): void {
  renderers.push(r)
}

export function findRenderer(step: Step): StepRenderer {
  let best: StepRenderer = GenericJsonRenderer
  let bestPriority = best.match(step)
  for (const r of renderers) {
    const p = r.match(step)
    if (p > bestPriority) {
      best = r
      bestPriority = p
    }
  }
  return best
}
```

- [ ] **Step 3: Add test**

```ts
it('picks ToolCallRenderer for tool_call kind', () => {
  expect(findRenderer(makeStep({ kind: 'tool_call' })).id).toBe('tool-call')
})
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @argus/web test
```

Expected: PASS — 17 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/session-replay/renderers
git commit -m "feat(web): tool-call renderer"
```

---

## Task 8: Step icons + StepRow + virtualized StepTimeline

**Files:**

- Create: `apps/web/src/features/session-replay/timeline/step-icons.ts`
- Create: `apps/web/src/features/session-replay/timeline/StepRow.tsx`
- Create: `apps/web/src/features/session-replay/timeline/StepTimeline.tsx`

- [ ] **Step 1: Create `timeline/step-icons.ts`**

```ts
import { Bot, Brain, Circle, Globe, Settings, User, Wrench, type LucideIcon } from 'lucide-react'
import type { Step } from '@argus/shared-types'

export function iconForStep(step: Step): LucideIcon {
  switch (step.kind) {
    case 'user_message':
      return User
    case 'assistant_message':
      return Bot
    case 'system_prompt':
      return Settings
    case 'llm_call':
      return Brain
    case 'tool_call':
      return Wrench
    case 'external_resource':
      return Globe
    default:
      return Circle
  }
}
```

- [ ] **Step 2: Create `timeline/StepRow.tsx`**

```tsx
import type { Step } from '@argus/shared-types'
import { cn } from '@/lib/utils'
import { durationMs, formatDuration } from '../lib/step-helpers'
import { iconForStep } from './step-icons'

interface Props {
  step: Step
  index: number
  active: boolean
  onClick: () => void
}

export function StepRow({ step, index, active, onClick }: Props) {
  const Icon = iconForStep(step)
  const label = step.kind ?? step.name
  const sub = step.componentName ?? step.name
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full flex items-start gap-2 px-3 py-2 text-left border-l-2 transition-colors',
        active ? 'bg-blue-50 border-l-blue-500' : 'border-l-transparent hover:bg-neutral-50',
      )}
    >
      <span className="text-xs text-neutral-400 w-6 shrink-0 mt-0.5 tabular-nums">{index + 1}</span>
      <Icon className="h-4 w-4 mt-0.5 text-neutral-600 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{label}</p>
        <p className="text-xs text-neutral-500 truncate">{sub}</p>
      </div>
      <div className="text-xs text-neutral-400 shrink-0 tabular-nums">
        {formatDuration(durationMs(step))}
      </div>
    </button>
  )
}
```

- [ ] **Step 3: Create `timeline/StepTimeline.tsx`**

```tsx
import { useEffect, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { Step } from '@argus/shared-types'
import { StepRow } from './StepRow'

interface Props {
  steps: Step[]
  activeStepId: string | undefined
  onSelect: (stepId: string) => void
}

export function StepTimeline({ steps, activeStepId, onSelect }: Props) {
  const parentRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: steps.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
    overscan: 6,
  })

  useEffect(() => {
    if (!activeStepId) return
    const i = steps.findIndex((s) => s.id === activeStepId)
    if (i >= 0) virtualizer.scrollToIndex(i, { align: 'center' })
  }, [activeStepId, steps, virtualizer])

  return (
    <div ref={parentRef} className="h-full overflow-auto">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((vi) => {
          const step = steps[vi.index]
          if (!step) return null
          return (
            <div
              key={vi.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${vi.start}px)`,
              }}
            >
              <StepRow
                step={step}
                index={vi.index}
                active={step.id === activeStepId}
                onClick={() => onSelect(step.id)}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Verify typecheck**

```bash
pnpm --filter @argus/web typecheck
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/session-replay/timeline
git commit -m "feat(web): virtualized step timeline + icons"
```

---

## Task 9: Step meta header + EventsTab + RawTab

**Files:**

- Create: `apps/web/src/features/session-replay/detail/StepMetaHeader.tsx`
- Create: `apps/web/src/features/session-replay/detail/EventsTab.tsx`
- Create: `apps/web/src/features/session-replay/detail/RawTab.tsx`

- [ ] **Step 1: Create `detail/StepMetaHeader.tsx`**

```tsx
import type { Step } from '@argus/shared-types'
import { Badge } from '@/components/ui/badge'
import { durationMs, formatDuration, tokenUsage } from '../lib/step-helpers'

interface Props {
  step: Step
}

function statusVariant(code: string) {
  if (code === 'OK') return 'default' as const
  if (code === 'ERROR') return 'destructive' as const
  return 'secondary' as const
}

export function StepMetaHeader({ step }: Props) {
  const tokens = tokenUsage(step)
  return (
    <div className="space-y-2 pb-3 border-b">
      <div className="flex items-baseline justify-between gap-3 min-w-0">
        <h3 className="text-base font-semibold truncate">{step.kind ?? step.name}</h3>
        <span className="text-xs font-mono text-neutral-400 shrink-0">
          {step.spanId.slice(0, 12)}
        </span>
      </div>
      <div className="flex flex-wrap gap-2 items-center text-xs text-neutral-500">
        <Badge variant={statusVariant(step.statusCode)}>{step.statusCode}</Badge>
        <span>{formatDuration(durationMs(step))}</span>
        {step.componentName && <span>· {step.componentName}</span>}
        {tokens && (
          <span>
            · tokens: {tokens.input}/{tokens.output}
          </span>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create `detail/EventsTab.tsx`**

```tsx
import type { Step } from '@argus/shared-types'

interface Props {
  step: Step
}

export function EventsTab({ step }: Props) {
  if (step.events.length === 0) {
    return <p className="text-neutral-500 text-sm">(no events)</p>
  }
  return (
    <ul className="space-y-3">
      {step.events.map((e) => (
        <li key={e.id} className="border rounded p-3">
          <div className="flex items-baseline justify-between text-xs text-neutral-500 mb-2">
            <span className="font-mono">{e.name}</span>
            <span>{new Date(e.ts).toLocaleTimeString()}</span>
          </div>
          <pre className="text-xs bg-neutral-50 border p-2 rounded overflow-auto">
            {JSON.stringify(e.attributes, null, 2)}
          </pre>
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 3: Create `detail/RawTab.tsx`**

```tsx
import type { Step } from '@argus/shared-types'

export function RawTab({ step }: { step: Step }) {
  return (
    <pre className="text-xs bg-neutral-50 border p-3 rounded overflow-auto">
      {JSON.stringify(step, null, 2)}
    </pre>
  )
}
```

- [ ] **Step 4: Verify typecheck**

```bash
pnpm --filter @argus/web typecheck
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/session-replay/detail
git commit -m "feat(web): step meta header + events + raw tabs"
```

---

## Task 10: StepDetail tabs container

**Files:**

- Create: `apps/web/src/features/session-replay/detail/StepDetail.tsx`

- [ ] **Step 1: Create `detail/StepDetail.tsx`**

```tsx
import type { Step } from '@argus/shared-types'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { findRenderer } from '../renderers/registry'
import { EventsTab } from './EventsTab'
import { RawTab } from './RawTab'
import { StepMetaHeader } from './StepMetaHeader'

export type TabKey = 'input' | 'output' | 'events' | 'raw'

interface Props {
  step: Step
  activeTab: TabKey
  onTabChange: (tab: TabKey) => void
}

export function StepDetail({ step, activeTab, onTabChange }: Props) {
  const renderer = findRenderer(step)

  return (
    <div className="h-full flex flex-col p-4 gap-4 overflow-hidden">
      <StepMetaHeader step={step} />
      <Tabs
        value={activeTab}
        onValueChange={(v) => onTabChange(v as TabKey)}
        className="flex-1 flex flex-col overflow-hidden"
      >
        <TabsList className="self-start">
          <TabsTrigger value="input">Input</TabsTrigger>
          <TabsTrigger value="output">Output</TabsTrigger>
          <TabsTrigger value="events">Events ({step.events.length})</TabsTrigger>
          <TabsTrigger value="raw">Raw</TabsTrigger>
        </TabsList>
        <TabsContent value="input" className="flex-1 overflow-auto mt-3">
          {renderer.renderInput ? (
            renderer.renderInput(step)
          ) : (
            <p className="text-neutral-500 text-sm">(no input renderer)</p>
          )}
        </TabsContent>
        <TabsContent value="output" className="flex-1 overflow-auto mt-3">
          {renderer.renderOutput ? (
            renderer.renderOutput(step)
          ) : (
            <p className="text-neutral-500 text-sm">(no output renderer)</p>
          )}
        </TabsContent>
        <TabsContent value="events" className="flex-1 overflow-auto mt-3">
          <EventsTab step={step} />
        </TabsContent>
        <TabsContent value="raw" className="flex-1 overflow-auto mt-3">
          <RawTab step={step} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
```

- [ ] **Step 2: Verify typecheck**

```bash
pnpm --filter @argus/web typecheck
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/session-replay/detail/StepDetail.tsx
git commit -m "feat(web): step detail tabs container with renderer dispatch"
```

---

## Task 11: SessionTopbar

**Files:**

- Create: `apps/web/src/features/session-replay/topbar/SessionTopbar.tsx`

- [ ] **Step 1: Create `topbar/SessionTopbar.tsx`**

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
}

function statusVariant(s: 'OK' | 'ERROR' | 'UNSET') {
  if (s === 'OK') return 'default' as const
  if (s === 'ERROR') return 'destructive' as const
  return 'secondary' as const
}

export function SessionTopbar({ session, steps }: Props) {
  const duration = sessionDurationMs(steps)
  const status = sessionStatus(steps)
  const tokens = sessionTokens(steps)
  return (
    <div className="border-b px-6 py-3 flex items-center gap-4">
      <Link
        to="/sessions"
        className="text-neutral-500 hover:text-neutral-900"
        aria-label="Back to sessions"
      >
        <ArrowLeft className="h-4 w-4" />
      </Link>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-base font-semibold truncate">
            {session.projectName} / {session.serviceName}
          </h2>
          <Badge variant={statusVariant(status)}>{status}</Badge>
        </div>
        <p className="text-xs font-mono text-neutral-400 truncate">{session.traceId}</p>
      </div>
      <div className="text-xs text-neutral-500 flex items-center gap-3 shrink-0 tabular-nums">
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

- [ ] **Step 2: Verify typecheck**

```bash
pnpm --filter @argus/web typecheck
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/session-replay/topbar
git commit -m "feat(web): session topbar with status, duration, tokens"
```

---

## Task 12: SessionReplay layout + route integration + root layout adjustments

**Files:**

- Create: `apps/web/src/features/session-replay/index.tsx`
- Modify: `apps/web/src/routes/__root.tsx` (remove p-6 padding so detail page can fill the viewport; let each route own its padding)
- Modify: `apps/web/src/routes/sessions/index.tsx` (add inner padding)
- Modify: `apps/web/src/routes/sessions/$sessionId.tsx` (validateSearch + delegate to SessionReplay)
- Regenerate: `apps/web/src/routeTree.gen.ts` (triggered by dev server)

- [ ] **Step 1: Create `features/session-replay/index.tsx`**

```tsx
import type { SessionSummary, Step } from '@argus/shared-types'
import { SessionTopbar } from './topbar/SessionTopbar'
import { StepDetail, type TabKey } from './detail/StepDetail'
import { StepTimeline } from './timeline/StepTimeline'

interface Props {
  session: SessionSummary
  steps: Step[]
  activeStepId: string | undefined
  activeTab: TabKey
  onSelectStep: (id: string) => void
  onSelectTab: (tab: TabKey) => void
}

export function SessionReplay({
  session,
  steps,
  activeStepId,
  activeTab,
  onSelectStep,
  onSelectTab,
}: Props) {
  const activeStep = steps.find((s) => s.id === activeStepId) ?? steps[0]
  return (
    <div className="h-full flex flex-col">
      <SessionTopbar session={session} steps={steps} />
      <div className="flex-1 grid grid-cols-[380px_1fr] overflow-hidden">
        <aside className="border-r overflow-hidden">
          <StepTimeline steps={steps} activeStepId={activeStep?.id} onSelect={onSelectStep} />
        </aside>
        <main className="overflow-hidden">
          {activeStep ? (
            <StepDetail step={activeStep} activeTab={activeTab} onTabChange={onSelectTab} />
          ) : (
            <p className="p-6 text-neutral-500 text-sm">(empty session — no steps)</p>
          )}
        </main>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Modify `apps/web/src/routes/__root.tsx`** — change the `<main>` element so it uses the full remaining viewport. Replace the file with:

```tsx
import { createRootRoute, Link, Outlet } from '@tanstack/react-router'

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  return (
    <div className="h-screen flex flex-col">
      <header className="border-b px-6 py-3 flex items-center gap-4 shrink-0">
        <Link to="/" className="text-lg font-bold tracking-tight">
          Argus
        </Link>
        <nav className="text-sm text-neutral-500">
          <Link to="/sessions" className="hover:text-neutral-900">
            Sessions
          </Link>
        </nav>
      </header>
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  )
}
```

- [ ] **Step 3: Modify `apps/web/src/routes/sessions/index.tsx`** — wrap the list in its own padding container since the root no longer provides it. Replace the file with:

```tsx
import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { fetchSessions } from '../../lib/api'

export const Route = createFileRoute('/sessions/')({
  component: SessionsList,
})

function SessionsList() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['sessions'],
    queryFn: fetchSessions,
  })

  if (isLoading) return <p className="p-6 text-neutral-500">Loading…</p>
  if (error) return <p className="p-6 text-red-600">Error: {String(error)}</p>
  if (!data || data.sessions.length === 0) {
    return (
      <div className="p-6 text-neutral-500">
        <p>No sessions yet.</p>
        <p className="text-sm mt-2">
          Try <code className="bg-neutral-100 px-1 rounded">pnpm db:seed</code> or send an OTLP
          payload to <code className="bg-neutral-100 px-1 rounded">POST /v1/traces</code>.
        </p>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-2 overflow-auto h-full">
      <h2 className="text-lg font-semibold mb-4">Sessions</h2>
      <table className="w-full text-sm">
        <thead className="text-left text-neutral-500">
          <tr>
            <th className="py-2">Project</th>
            <th>Service</th>
            <th>Trace</th>
            <th>Steps</th>
            <th>Started</th>
          </tr>
        </thead>
        <tbody>
          {data.sessions.map((s) => (
            <tr key={s.id} className="border-t hover:bg-neutral-50">
              <td className="py-2">{s.projectName}</td>
              <td>{s.serviceName}</td>
              <td className="font-mono text-xs">
                <Link
                  to="/sessions/$sessionId"
                  params={{ sessionId: s.id }}
                  className="text-blue-700 hover:underline"
                >
                  {s.traceId.slice(0, 16)}…
                </Link>
              </td>
              <td>{s.stepCount}</td>
              <td className="text-neutral-500">{new Date(s.startedAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 4: Modify `apps/web/src/routes/sessions/$sessionId.tsx`** — full replacement with validateSearch + SessionReplay delegation.

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { fetchSession } from '../../lib/api'
import { SessionReplay } from '../../features/session-replay'
import type { TabKey } from '../../features/session-replay/detail/StepDetail'

const searchSchema = z.object({
  step: z.string().optional(),
  tab: z.enum(['input', 'output', 'events', 'raw']).default('input'),
})

export const Route = createFileRoute('/sessions/$sessionId')({
  validateSearch: searchSchema,
  component: SessionDetail,
})

function SessionDetail() {
  const { sessionId } = Route.useParams()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const { data, isLoading, error } = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => fetchSession(sessionId),
  })

  if (isLoading) return <div className="p-6 text-neutral-500">Loading…</div>
  if (error) return <div className="p-6 text-red-600">Error: {String(error)}</div>
  if (!data) return <div className="p-6">Not found</div>

  return (
    <SessionReplay
      session={data.session}
      steps={data.steps}
      activeStepId={search.step}
      activeTab={search.tab}
      onSelectStep={(step) => navigate({ search: (prev) => ({ ...prev, step }), replace: true })}
      onSelectTab={(tab: TabKey) =>
        navigate({ search: (prev) => ({ ...prev, tab }), replace: true })
      }
    />
  )
}
```

- [ ] **Step 5: Regenerate route tree by running dev briefly**

```bash
pnpm --filter @argus/web dev > /tmp/web-regen.log 2>&1 &
WEB_PID=$!
sleep 6
kill $WEB_PID 2>/dev/null
wait $WEB_PID 2>/dev/null || true
```

Confirm `apps/web/src/routeTree.gen.ts` is updated (touched timestamp, presence of `validateSearch` in the generated content).

- [ ] **Step 6: Verify typecheck + build**

```bash
pnpm --filter @argus/web typecheck
pnpm --filter @argus/web build
```

Expected: 0 errors; build succeeds.

- [ ] **Step 7: Commit** (include the regenerated route tree)

```bash
git add apps/web/src/features/session-replay/index.tsx \
        apps/web/src/routes/__root.tsx \
        apps/web/src/routes/sessions/index.tsx \
        apps/web/src/routes/sessions/\$sessionId.tsx \
        apps/web/src/routeTree.gen.ts
git commit -m "feat(web): structured session replay layout with timeline + detail tabs"
```

---

## Task 13: M2 end-to-end acceptance

No code changes — verification only.

- [ ] **Step 1: Clean install + pipeline**

```bash
rm -rf node_modules apps/*/node_modules packages/*/node_modules
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Expected: every step exits 0. Web test count should be at least 17 (12 from M2-2/M2-3 plus the renderer matching tests added in M2-4..7).

- [ ] **Step 2: Live UI verification with seed data**

```bash
pnpm db:up
sleep 5
pnpm db:migrate
pnpm db:seed

DATABASE_URL=postgres://argus:argus@localhost:5432/argus pnpm dev > /tmp/argus.log 2>&1 &
DEV_PID=$!
sleep 8
```

Then **open http://localhost:5173 in a browser** and verify the following manually:

1. The home redirects to `/sessions`.
2. The list shows the seeded `demo / weather-bot` session with `6 steps`.
3. Click into the session. The URL becomes `/sessions/<uuid>` (no search params yet).
4. The Topbar shows project/service name, an `OK` badge, the total duration, and `tokens: 120/45` (from the LLM step).
5. The left timeline lists 6 rows with kind icons (Settings, User, Brain, Wrench, Bot, and the root span).
6. Click the user_message row. URL gets `?step=<uuid>`. Right side shows a blue speech bubble with the Chinese question.
7. Click the llm_call row. Right side shows the LLM renderer: model name + token counts in the header, then the Input tab. Switch to the Output tab — see the assistant text "I'll check the weather for Hefei." in an amber-tinted box. URL becomes `?step=<uuid>&tab=output`.
8. Click the tool_call row. Input shows tool name `get_weather` and arguments; Output shows the green result (`temperature: 30, condition: Sunny`).
9. Switch to the Raw tab — shows the full JSON of the step including events.
10. Switch to Events tab — shows the events list with timestamps.
11. Reload the page with the URL containing `?step=<uuid>&tab=output` — the same step + tab are restored.
12. Click the back arrow in the topbar — returns to the session list.

Cleanup:

```bash
kill $DEV_PID 2>/dev/null
wait $DEV_PID 2>/dev/null || true
pnpm db:down
```

If any of #1–#12 fail, capture details and STOP. Otherwise continue.

- [ ] **Step 3: Tag + push**

```bash
git tag -a m2-structured-replay -m "M2 structured replay complete

Acceptance:
- pnpm install/typecheck/lint/test/build all green (17 tests across web)
- Sessions list renders unchanged
- Session detail uses left timeline (virtualized) + right tabbed detail
- 4 specialized renderers (user/assistant/llm/tool) + Generic JSON fallback
- URL search params drive step + tab selection; reload restores state
- Topbar shows project/service, status, duration, token totals
"
git push origin main
git push origin m2-structured-replay
```

- [ ] **Step 4: Confirm CI is green** on GitHub Actions for `main`.

---

## Acceptance summary

M2 is complete when:

- [ ] `pnpm install` from clean state succeeds
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` all exit 0
- [ ] At least 17 web tests pass (step-helpers + registry + renderer match coverage)
- [ ] Session detail UI no longer shows a raw JSON dump by default; it shows topbar + timeline + tabbed detail
- [ ] All 4 specialized renderers visibly differ from the Generic JSON renderer (verified manually with seed data)
- [ ] URL search params (`?step=` / `?tab=`) drive selection; reload restores state
- [ ] Tag `m2-structured-replay` pushed to origin; CI green

Once this lands, the next milestone is **M3 — Live SSE push** (the `pusher` module + `useSessionStream` hook).
