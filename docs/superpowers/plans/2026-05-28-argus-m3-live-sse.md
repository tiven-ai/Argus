# Argus M3 — Live SSE Push Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When OTLP traces arrive while a session detail page is open, the browser sees new steps appear in real time without a manual refresh.

**Architecture:** Add a `MessageBus` interface with an in-proc EventEmitter implementation. After `PgStorage.writeTrace` commits, the ingest route publishes each written step (in API-shaped form) to `session:<sessionId>` channel. A new `pusher` module exposes `GET /api/sessions/:sessionId/stream` as Server-Sent Events: it subscribes to the bus, replays any steps after `Last-Event-ID` on reconnect, sends `: heartbeat` every 15s. On the web side, a new `useSessionStream` hook opens an `EventSource` and patches the existing TanStack Query cache by appending new steps. The topbar shows a `LIVE` indicator while the stream is connected.

**Tech Stack additions:** No new third-party deps — uses Node's built-in `events` and `Response` write APIs, browser `EventSource`. Refactor surfaces: `StorageBackend.writeTrace` returns the written steps (so the publisher knows what to emit); a small mapper extracts the existing `StoredStep -> API Step` conversion that lives inline in `api/routes.ts`.

**Scope deliberately excluded** (later milestones):

- Buffered backpressure (200 events/sec + 100ms batching) — M3 just emits one SSE event per step; node socket back-pressure is the only mitigation
- Long-polling fallback when SSE blocked by proxies — not implemented
- Cross-process pubsub (Redis) — `MessageBus` interface preserved so M5+ can swap in
- Authentication on the SSE endpoint — M4 adds session cookie auth

**Reference spec:** [docs/superpowers/specs/2026-05-28-argus-design.md](../specs/2026-05-28-argus-design.md)

---

## File Structure (after M3)

```
apps/server/
├── src/
│   ├── modules/
│   │   ├── pubsub/                  (NEW)
│   │   │   ├── index.ts
│   │   │   ├── types.ts             (MessageBus interface)
│   │   │   └── in-proc.ts           (InProcMessageBus)
│   │   ├── pusher/                  (NEW)
│   │   │   ├── index.ts
│   │   │   ├── sse.ts               (formatSseEvent helper)
│   │   │   └── routes.ts            (GET /api/sessions/:id/stream)
│   │   ├── api/
│   │   │   ├── mappers.ts           (NEW — storedStepToApi)
│   │   │   ├── routes.ts            (MODIFIED — use mapper)
│   │   │   └── index.ts             (unchanged)
│   │   ├── storage/
│   │   │   ├── types.ts             (MODIFIED — WriteTraceResult)
│   │   │   ├── pg.ts                (MODIFIED — return value)
│   │   │   └── index.ts             (unchanged)
│   │   └── ingest/
│   │       └── routes.ts            (MODIFIED — publish to bus)
│   ├── server.ts                    (MODIFIED — wire bus + pusher)
│   └── ...
└── test/
    ├── pubsub/
    │   └── in-proc.test.ts          (NEW)
    ├── pusher/
    │   ├── sse.test.ts              (NEW)
    │   └── sse-integration.test.ts  (NEW)
    └── storage/pg.test.ts           (MODIFIED — assert WriteTraceResult)

apps/web/
└── src/
    ├── lib/
    │   └── use-session-stream.ts    (NEW)
    ├── features/session-replay/
    │   ├── index.tsx                (MODIFIED — pass `connected` prop)
    │   └── topbar/
    │       └── SessionTopbar.tsx    (MODIFIED — LIVE indicator)
    └── routes/sessions/$sessionId.tsx (MODIFIED — call hook)
```

---

## Common Conventions

- All imports use `.js` extensions on the server side (NodeNext).
- Bus channels are typed loosely (`string`) at the interface; convention is `session:<sessionId>`.
- SSE event payload is always JSON-encoded with a leading `id:` and ending `\n\n`.
- Heartbeat lines start with `:` so the client ignores them per the SSE spec.
- Commit messages use Conventional Commits with lowercase subject (commitlint enforces).

---

## Task 1: MessageBus interface + InProcMessageBus + tests

**Files:**

- Create: `apps/server/src/modules/pubsub/types.ts`
- Create: `apps/server/src/modules/pubsub/in-proc.ts`
- Create: `apps/server/src/modules/pubsub/index.ts`
- Create: `apps/server/test/pubsub/in-proc.test.ts`

- [ ] **Step 1: Write the failing test `in-proc.test.ts`**

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InProcMessageBus } from '../../src/modules/pubsub/in-proc.js'

describe('InProcMessageBus', () => {
  let bus: InProcMessageBus

  afterEach(() => {
    bus?.removeAllSubscribers()
  })

  it('delivers a published payload to a subscriber on the same channel', () => {
    bus = new InProcMessageBus()
    const handler = vi.fn()
    bus.subscribe('ch1', handler)
    bus.publish('ch1', { foo: 'bar' })
    expect(handler).toHaveBeenCalledExactlyOnceWith({ foo: 'bar' })
  })

  it('does NOT deliver to a different channel', () => {
    bus = new InProcMessageBus()
    const handler = vi.fn()
    bus.subscribe('ch1', handler)
    bus.publish('ch2', { foo: 'bar' })
    expect(handler).not.toHaveBeenCalled()
  })

  it('delivers to all subscribers of a channel', () => {
    bus = new InProcMessageBus()
    const h1 = vi.fn()
    const h2 = vi.fn()
    bus.subscribe('ch1', h1)
    bus.subscribe('ch1', h2)
    bus.publish('ch1', 'hi')
    expect(h1).toHaveBeenCalledExactlyOnceWith('hi')
    expect(h2).toHaveBeenCalledExactlyOnceWith('hi')
  })

  it('unsubscribe returned by subscribe stops delivery to that handler only', () => {
    bus = new InProcMessageBus()
    const h1 = vi.fn()
    const h2 = vi.fn()
    const off1 = bus.subscribe('ch1', h1)
    bus.subscribe('ch1', h2)
    off1()
    bus.publish('ch1', 'hi')
    expect(h1).not.toHaveBeenCalled()
    expect(h2).toHaveBeenCalledExactlyOnceWith('hi')
  })
})
```

- [ ] **Step 2: Run the test, confirm it FAILS**

```bash
pnpm --filter @argus/server test
```

Expected: FAIL — `Cannot find module '.../pubsub/in-proc.js'`.

- [ ] **Step 3: Create `apps/server/src/modules/pubsub/types.ts`**

```ts
export type MessageHandler = (payload: unknown) => void

export interface MessageBus {
  /** Publish a payload to all subscribers of the channel. Returns synchronously after dispatch. */
  publish(channel: string, payload: unknown): void

  /** Subscribe to a channel. Returns an unsubscribe function. */
  subscribe(channel: string, handler: MessageHandler): () => void

  /** Remove all subscribers from all channels (testing/teardown helper). */
  removeAllSubscribers(): void
}
```

- [ ] **Step 4: Create `apps/server/src/modules/pubsub/in-proc.ts`**

```ts
import { EventEmitter } from 'node:events'
import type { MessageBus, MessageHandler } from './types.js'

export class InProcMessageBus implements MessageBus {
  private readonly emitter = new EventEmitter()

  constructor() {
    // Default limit (10) is fine for M3 — each SSE connection adds 1 listener.
    // Bump only if a single session has hundreds of concurrent watchers.
    this.emitter.setMaxListeners(100)
  }

  publish(channel: string, payload: unknown): void {
    this.emitter.emit(channel, payload)
  }

  subscribe(channel: string, handler: MessageHandler): () => void {
    this.emitter.on(channel, handler)
    return () => {
      this.emitter.off(channel, handler)
    }
  }

  removeAllSubscribers(): void {
    this.emitter.removeAllListeners()
  }
}
```

- [ ] **Step 5: Create `apps/server/src/modules/pubsub/index.ts`**

```ts
export type { MessageBus, MessageHandler } from './types.js'
export { InProcMessageBus } from './in-proc.js'
```

- [ ] **Step 6: Run the test, confirm it PASSES**

```bash
pnpm --filter @argus/server test
```

Expected: PASS — 4 new tests in `in-proc.test.ts`; existing tests still pass.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/modules/pubsub apps/server/test/pubsub
git commit -m "feat(server): in-process MessageBus with EventEmitter backing"
```

---

## Task 2: storedStepToApi mapper + writeTrace returns WriteTraceResult

**Files:**

- Create: `apps/server/src/modules/api/mappers.ts`
- Modify: `apps/server/src/modules/storage/types.ts`
- Modify: `apps/server/src/modules/storage/pg.ts`
- Modify: `apps/server/src/modules/api/routes.ts`
- Modify: `apps/server/test/storage/pg.test.ts`

This task extracts the existing `StoredStep -> Step` conversion into a reusable mapper, then changes `StorageBackend.writeTrace` to return what was written. After this task, ingest can publish to the bus using a structured API-shaped step.

- [ ] **Step 1: Create `apps/server/src/modules/api/mappers.ts`**

```ts
import type { Step, StepEvent } from '@argus/shared-types'
import type { StoredStep, StoredStepEvent } from '../storage/types.js'

export function storedEventToApi(e: StoredStepEvent): StepEvent {
  return {
    id: e.id,
    name: e.name,
    ts: e.ts.toISOString(),
    attributes: e.attributes,
  }
}

export function storedStepToApi(step: StoredStep): Step {
  return {
    id: step.id,
    spanId: step.spanId,
    parentSpanId: step.parentSpanId,
    name: step.name,
    kind: step.kind,
    componentType: step.componentType,
    componentName: step.componentName,
    startedAt: step.startedAt.toISOString(),
    endedAt: step.endedAt.toISOString(),
    attributes: step.attributes,
    statusCode: step.statusCode,
    statusMessage: step.statusMessage,
    events: step.events.map(storedEventToApi),
  }
}
```

- [ ] **Step 2: Modify `apps/server/src/modules/storage/types.ts`** to add `WriteTraceResult` and update the `writeTrace` signature. Replace the existing `StorageBackend` interface with:

```ts
export interface WriteTraceResult {
  sessionId: string
  /** Steps that were inserted or updated by this call, in input order. */
  writtenSteps: StoredStep[]
}

export interface StorageBackend {
  /**
   * Upserts project + service + session, then inserts steps (and their events).
   * Returns the session id and the steps that were written (with their DB ids
   * and updated step_event rows), so callers can publish them downstream.
   */
  writeTrace(input: WriteTraceInput): Promise<WriteTraceResult>

  /** Returns sessions for an org, most recently started first. */
  listSessions(opts: { orgId: string; limit?: number }): Promise<StoredSessionSummary[]>

  /** Returns one session with all its steps + step events, or null. */
  getSession(opts: { orgId: string; sessionId: string }): Promise<StoredSessionDetail | null>
}
```

(Keep all the other interfaces — `NewStep`, `NewStepEvent`, `WriteTraceInput`, `StoredStep`, etc — unchanged.)

- [ ] **Step 3: Modify `apps/server/src/modules/storage/pg.ts`** so `writeTrace` returns the result. Inside the existing transaction body, after the `step_count` recompute, build the result by reading the post-write step rows + events. Replace the current `writeTrace` method body with:

```ts
  async writeTrace(input: WriteTraceInput): Promise<WriteTraceResult> {
    const insertedSpanIds: string[] = []

    const sessionId = await this.db.transaction().execute(async (trx) => {
      const projectId = await this.upsertProject(trx, input.orgId, input.projectName)
      const serviceId = await this.upsertService(trx, projectId, input.serviceName)
      const sessionId = await this.upsertSession(
        trx,
        serviceId,
        input.traceId,
        input.sessionStartedAt,
        input.sessionEndedAt,
      )

      for (const step of input.steps) {
        const stepId = await this.upsertStep(trx, sessionId, step)
        if (step.events.length > 0) {
          await trx.deleteFrom('step_events').where('step_id', '=', stepId).execute()
          await trx
            .insertInto('step_events')
            .values(
              step.events.map((e) => ({
                step_id: stepId,
                name: e.name,
                ts: e.ts,
                attributes: JSON.stringify(e.attributes),
              })),
            )
            .execute()
        }
        insertedSpanIds.push(step.spanId)
      }

      const { count } = await trx
        .selectFrom('steps')
        .select((eb) => eb.fn.countAll().as('count'))
        .where('session_id', '=', sessionId)
        .executeTakeFirstOrThrow()
      await trx
        .updateTable('sessions')
        .set({ step_count: Number(count) })
        .where('id', '=', sessionId)
        .execute()

      return sessionId
    })

    // After commit, read back the written steps in input order, with their events.
    const detail = await this.getSession({ orgId: input.orgId, sessionId })
    const writtenSteps: StoredStep[] =
      detail?.steps.filter((s) => insertedSpanIds.includes(s.spanId)) ?? []

    return { sessionId, writtenSteps }
  }
```

(Don't change `upsertProject`, `upsertService`, `upsertSession`, `upsertStep`, `listSessions`, `getSession` bodies — only `writeTrace` changes.)

- [ ] **Step 4: Modify `apps/server/src/modules/api/routes.ts`** to use the mapper. Replace the inline transformation in the GET `/api/sessions/:sessionId` handler with calls to `storedStepToApi`. The full new file:

```ts
import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import type { StorageBackend } from '../storage/types.js'
import { DEFAULT_ORG_ID } from '../../constants.js'
import { storedStepToApi } from './mappers.js'

export interface ApiRoutesDeps {
  storage: StorageBackend
}

export const apiRoutes: FastifyPluginAsync<ApiRoutesDeps> = async (app: FastifyInstance, deps) => {
  app.get('/api/sessions', async (request) => {
    const query = request.query as { limit?: string }
    const limit = query.limit ? Math.min(200, Math.max(1, parseInt(query.limit, 10))) : 50
    const sessions = await deps.storage.listSessions({ orgId: DEFAULT_ORG_ID, limit })
    return {
      sessions: sessions.map((s) => ({
        id: s.id,
        traceId: s.traceId,
        projectName: s.projectName,
        serviceName: s.serviceName,
        startedAt: s.startedAt.toISOString(),
        endedAt: s.endedAt ? s.endedAt.toISOString() : null,
        stepCount: s.stepCount,
      })),
    }
  })

  app.get('/api/sessions/:sessionId', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string }
    const detail = await deps.storage.getSession({ orgId: DEFAULT_ORG_ID, sessionId })
    if (!detail) {
      reply.code(404)
      return { error: 'not_found' }
    }
    return {
      session: {
        id: detail.id,
        traceId: detail.traceId,
        projectName: detail.projectName,
        serviceName: detail.serviceName,
        startedAt: detail.startedAt.toISOString(),
        endedAt: detail.endedAt ? detail.endedAt.toISOString() : null,
        stepCount: detail.stepCount,
      },
      steps: detail.steps.map(storedStepToApi),
    }
  })
}
```

- [ ] **Step 5: Add tests to `apps/server/test/storage/pg.test.ts`** for the new return shape. Inside the `describe('writeTrace', ...)` block, add the following two tests at the end:

```ts
it('returns sessionId and the written steps with DB ids', async () => {
  const traceId = '5'.repeat(32)
  const result = await storage.writeTrace({
    orgId: DEFAULT_ORG_ID,
    projectName: 'p1',
    serviceName: 's1',
    traceId,
    sessionStartedAt: new Date('2026-05-28T12:00:00Z'),
    sessionEndedAt: null,
    steps: [
      makeStep({ spanId: 'a'.repeat(16) }),
      makeStep({ spanId: 'b'.repeat(16), parentSpanId: 'a'.repeat(16) }),
    ],
  })
  expect(result.sessionId).toMatch(/^[0-9a-f-]{36}$/)
  expect(result.writtenSteps).toHaveLength(2)
  const spanIds = result.writtenSteps.map((s) => s.spanId).sort()
  expect(spanIds).toEqual(['a'.repeat(16), 'b'.repeat(16)])
  // Each returned step has a DB id assigned.
  for (const s of result.writtenSteps) {
    expect(s.id).toMatch(/^[0-9a-f-]{36}$/)
  }
})

it('returned writtenSteps include events', async () => {
  const result = await storage.writeTrace({
    orgId: DEFAULT_ORG_ID,
    projectName: 'p1',
    serviceName: 's1',
    traceId: '6'.repeat(32),
    sessionStartedAt: new Date('2026-05-28T12:00:00Z'),
    sessionEndedAt: null,
    steps: [
      makeStep({
        spanId: 'c'.repeat(16),
        events: [
          {
            name: 'argus.input',
            ts: new Date('2026-05-28T12:00:00.5Z'),
            attributes: { text: 'hi' },
          },
        ],
      }),
    ],
  })
  expect(result.writtenSteps).toHaveLength(1)
  expect(result.writtenSteps[0]?.events).toHaveLength(1)
  expect(result.writtenSteps[0]?.events[0]?.attributes).toEqual({ text: 'hi' })
})
```

- [ ] **Step 6: Run all server tests**

```bash
pnpm --filter @argus/server test
```

Expected: PASS — existing tests still pass (writeTrace return value is a superset, callers ignoring it still work) + 2 new tests = 22 server tests.

- [ ] **Step 7: Build shared-types so the mapper compiles**

```bash
pnpm --filter @argus/shared-types build
```

- [ ] **Step 8: Typecheck server**

```bash
pnpm --filter @argus/server typecheck
```

Expected: 0 errors.

- [ ] **Step 9: Commit**

```bash
git add apps/server
git commit -m "refactor(server): writeTrace returns WriteTraceResult; extract storedStepToApi mapper"
```

---

## Task 3: SSE encoding helper + Pusher routes

**Files:**

- Create: `apps/server/src/modules/pusher/sse.ts`
- Create: `apps/server/src/modules/pusher/routes.ts`
- Create: `apps/server/src/modules/pusher/index.ts`
- Create: `apps/server/test/pusher/sse.test.ts`

- [ ] **Step 1: Write `apps/server/test/pusher/sse.test.ts` (TDD for the encoder)**

```ts
import { describe, expect, it } from 'vitest'
import { formatSseEvent, formatSseComment } from '../../src/modules/pusher/sse.js'

describe('formatSseEvent', () => {
  it('emits id + data lines + terminator', () => {
    const out = formatSseEvent('step-id-1', { type: 'step', step: { id: 'x' } })
    expect(out).toBe('id: step-id-1\ndata: {"type":"step","step":{"id":"x"}}\n\n')
  })

  it('encodes id-less events', () => {
    const out = formatSseEvent(undefined, { type: 'init' })
    expect(out).toBe('data: {"type":"init"}\n\n')
  })

  it('does not contain unescaped CR or LF in the data field', () => {
    const out = formatSseEvent('id', { text: 'line1\nline2' })
    // The data line itself has no literal newline outside the framing — the
    // JSON encoding escapes \n inside the string.
    const dataLine = out.split('\n').find((l) => l.startsWith('data: '))!
    expect(dataLine.includes('\\n')).toBe(true)
    expect(dataLine.split('\n')).toHaveLength(1)
  })
})

describe('formatSseComment', () => {
  it('emits a comment-prefixed line with terminator', () => {
    expect(formatSseComment('heartbeat')).toBe(': heartbeat\n\n')
  })
})
```

- [ ] **Step 2: Run, confirm FAIL**

```bash
pnpm --filter @argus/server test
```

Expected: FAIL — `Cannot find module '.../pusher/sse.js'`.

- [ ] **Step 3: Create `apps/server/src/modules/pusher/sse.ts`**

```ts
/**
 * SSE framing helpers. JSON encoding escapes embedded newlines automatically,
 * so the resulting `data:` line is always a single physical line.
 */

export function formatSseEvent(id: string | undefined, payload: unknown): string {
  const data = `data: ${JSON.stringify(payload)}\n\n`
  return id !== undefined ? `id: ${id}\n${data}` : data
}

export function formatSseComment(comment: string): string {
  return `: ${comment}\n\n`
}
```

- [ ] **Step 4: Create `apps/server/src/modules/pusher/routes.ts`**

```ts
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify'
import { DEFAULT_ORG_ID } from '../../constants.js'
import { storedStepToApi } from '../api/mappers.js'
import type { MessageBus, MessageHandler } from '../pubsub/types.js'
import type { Step } from '@argus/shared-types'
import type { StorageBackend } from '../storage/types.js'
import { formatSseComment, formatSseEvent } from './sse.js'

export interface PusherRoutesDeps {
  storage: StorageBackend
  bus: MessageBus
}

const HEARTBEAT_INTERVAL_MS = 15_000

export const pusherRoutes: FastifyPluginAsync<PusherRoutesDeps> = async (
  app: FastifyInstance,
  deps,
) => {
  app.get<{ Params: { sessionId: string } }>(
    '/api/sessions/:sessionId/stream',
    async (request, reply) => {
      const { sessionId } = request.params
      const lastEventId = readLastEventId(request)

      reply.hijack()
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      })

      // Initial replay: any steps written after lastEventId (if provided).
      if (lastEventId) {
        const detail = await deps.storage.getSession({
          orgId: DEFAULT_ORG_ID,
          sessionId,
        })
        if (detail) {
          const idx = detail.steps.findIndex((s) => s.id === lastEventId)
          const replay = idx >= 0 ? detail.steps.slice(idx + 1) : []
          for (const stored of replay) {
            const step = storedStepToApi(stored)
            reply.raw.write(formatSseEvent(step.id, { type: 'step', step }))
          }
        }
      }

      // Initial sync marker so the client knows the stream is live.
      reply.raw.write(formatSseEvent(undefined, { type: 'connected' }))

      // Live subscription.
      const handler: MessageHandler = (payload) => {
        const step = payload as Step
        try {
          reply.raw.write(formatSseEvent(step.id, { type: 'step', step }))
        } catch {
          // Socket already closed; cleanup will run via 'close' handler below.
        }
      }
      const unsubscribe = deps.bus.subscribe(`session:${sessionId}`, handler)

      // Heartbeat to keep proxies from closing idle connections.
      const heartbeat = setInterval(() => {
        try {
          reply.raw.write(formatSseComment('heartbeat'))
        } catch {
          // Same as above.
        }
      }, HEARTBEAT_INTERVAL_MS)

      // Cleanup when the client disconnects.
      request.raw.on('close', () => {
        unsubscribe()
        clearInterval(heartbeat)
        try {
          reply.raw.end()
        } catch {
          // already ended
        }
      })
    },
  )
}

function readLastEventId(req: FastifyRequest): string | undefined {
  // EventSource sends Last-Event-ID on auto-reconnect; check both header casings.
  const fromHeader =
    req.headers['last-event-id'] ?? (req.headers as Record<string, string>)['Last-Event-ID']
  if (typeof fromHeader === 'string' && fromHeader.length > 0) return fromHeader
  // Allow ?lastEventId=... query param for testing / curl scenarios.
  const q = req.query as { lastEventId?: string } | undefined
  return q?.lastEventId
}
```

- [ ] **Step 5: Create `apps/server/src/modules/pusher/index.ts`**

```ts
export { pusherRoutes } from './routes.js'
export { formatSseEvent, formatSseComment } from './sse.js'
```

- [ ] **Step 6: Run tests, confirm PASS**

```bash
pnpm --filter @argus/server test
```

Expected: 4 new SSE encoder tests pass + 22 from before = 26 server tests.

- [ ] **Step 7: Typecheck**

```bash
pnpm --filter @argus/server typecheck
```

Expected: 0 errors (note: `pusherRoutes` isn't registered yet — that happens in Task 4 — but the file compiles standalone).

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/modules/pusher apps/server/test/pusher
git commit -m "feat(server): SSE encoder helpers + pusher routes (not yet wired)"
```

---

## Task 4: Server factory wires bus + pusher; ingest publishes

**Files:**

- Modify: `apps/server/src/server.ts`
- Modify: `apps/server/src/modules/ingest/routes.ts`

- [ ] **Step 1: Replace `apps/server/src/server.ts`**

```ts
import Fastify, { type FastifyInstance } from 'fastify'
import type { Kysely } from 'kysely'
import type { DB } from './db/schema.js'
import { createKysely } from './db/kysely.js'
import { PgStorage } from './modules/storage/pg.js'
import { InProcMessageBus } from './modules/pubsub/index.js'
import type { MessageBus } from './modules/pubsub/types.js'
import { ingestRoutes } from './modules/ingest/index.js'
import { apiRoutes } from './modules/api/index.js'
import { pusherRoutes } from './modules/pusher/index.js'

export interface ServerOptions {
  databaseUrl: string
  logLevel?: string
}

export interface ArgusServer {
  app: FastifyInstance
  db: Kysely<DB>
  bus: MessageBus
}

export async function createServer(opts: ServerOptions): Promise<ArgusServer> {
  const app = Fastify({
    logger: { level: opts.logLevel ?? 'info' },
    bodyLimit: 8 * 1024 * 1024,
  })

  const db = createKysely(opts.databaseUrl)
  const storage = new PgStorage(db)
  const bus = new InProcMessageBus()

  app.get('/healthz', async () => ({ status: 'ok' }))
  await app.register(ingestRoutes, { storage, bus })
  await app.register(apiRoutes, { storage })
  await app.register(pusherRoutes, { storage, bus })

  app.addHook('onClose', async () => {
    bus.removeAllSubscribers()
    await db.destroy()
  })

  return { app, db, bus }
}
```

- [ ] **Step 2: Replace `apps/server/src/modules/ingest/routes.ts`**

```ts
import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import type { StorageBackend } from '../storage/types.js'
import type { MessageBus } from '../pubsub/types.js'
import { storedStepToApi } from '../api/mappers.js'
import { OtlpParseError, parseOtlpRequest } from './parser.js'
import { otlpExportRequestSchema } from './otlp-json.js'

export interface IngestRoutesDeps {
  storage: StorageBackend
  bus: MessageBus
}

export const ingestRoutes: FastifyPluginAsync<IngestRoutesDeps> = async (
  app: FastifyInstance,
  deps,
) => {
  app.post('/v1/traces', async (request, reply) => {
    const parseResult = otlpExportRequestSchema.safeParse(request.body)
    if (!parseResult.success) {
      reply.code(400)
      return { error: 'invalid_otlp_payload', issues: parseResult.error.issues }
    }

    let traces
    try {
      traces = parseOtlpRequest(parseResult.data)
    } catch (err) {
      if (err instanceof OtlpParseError) {
        reply.code(400)
        return { error: 'invalid_otlp_payload', message: err.message }
      }
      throw err
    }

    let acceptedCount = 0
    for (const trace of traces) {
      const result = await deps.storage.writeTrace(trace)
      for (const stored of result.writtenSteps) {
        deps.bus.publish(`session:${result.sessionId}`, storedStepToApi(stored))
      }
      acceptedCount += result.writtenSteps.length
    }

    reply.code(200)
    return { accepted: acceptedCount }
  })
}
```

- [ ] **Step 3: Update the existing ingest routes test** (`apps/server/test/ingest/routes.test.ts`) — its `makeApp()` helper currently registers `ingestRoutes` with `{ storage }` only. Add `bus` (use the real `InProcMessageBus`).

Replace the imports + `makeApp` block in `apps/server/test/ingest/routes.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { ingestRoutes } from '../../src/modules/ingest/index.js'
import { PgStorage } from '../../src/modules/storage/pg.js'
import { InProcMessageBus } from '../../src/modules/pubsub/index.js'
import { createTestDb, truncateAll } from '../helpers/db.js'
```

And the makeApp function (find it inside the describe block and replace):

```ts
async function makeApp() {
  const app = Fastify()
  const bus = new InProcMessageBus()
  await app.register(ingestRoutes, { storage, bus })
  return app
}
```

(Keep all other test code in the file unchanged.)

- [ ] **Step 4: Run all server tests**

```bash
pnpm --filter @argus/server test
```

Expected: 26 tests pass (same count — only the makeApp factory changed).

- [ ] **Step 5: Manual smoke (end-to-end with curl)**

```bash
pnpm db:up
sleep 5
pnpm db:migrate
DATABASE_URL=postgres://argus:argus@localhost:5432/argus pnpm --filter @argus/server dev > /tmp/argus.log 2>&1 &
SERVER_PID=$!
sleep 3

# Open the stream (in the background) and capture output
(curl -sN --max-time 5 http://localhost:4000/api/sessions/00000000-0000-0000-0000-000000000000/stream > /tmp/sse.log 2>&1 &)

# Wait a moment so SSE handshake completes
sleep 1

# Ingest a fresh OTLP payload
curl -sf -X POST http://localhost:4000/v1/traces \
  -H 'Content-Type: application/json' \
  --data-binary @scripts/example-trace.json

# Wait for SSE events to arrive
sleep 3

# Show what SSE produced
echo "--- /tmp/sse.log ---"
cat /tmp/sse.log

kill $SERVER_PID 2>/dev/null
wait $SERVER_PID 2>/dev/null || true
pnpm db:down
```

NOTE: the URL in the SSE curl uses a placeholder session id that doesn't exist yet — the connection will still open and you'll see the `connected` event but no step events (because the OTLP payload creates a new session with a different id, not the one in the URL). This step verifies the SSE endpoint accepts a connection and the heartbeat fires; the full end-to-end with publish is tested in Task 7 with knowledge of the right session id.

Expected `/tmp/sse.log` content:

- A `connected` event: `data: {"type":"connected"}\n\n`
- Possibly a `: heartbeat\n\n` if the run was long enough

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/server.ts apps/server/src/modules/ingest/routes.ts apps/server/test/ingest/routes.test.ts
git commit -m "feat(server): wire MessageBus + pusher; ingest publishes written steps"
```

---

## Task 5: useSessionStream hook

**Files:**

- Create: `apps/web/src/lib/use-session-stream.ts`

- [ ] **Step 1: Create `apps/web/src/lib/use-session-stream.ts`**

```ts
import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { GetSessionResponse, Step } from '@argus/shared-types'

interface UseSessionStreamResult {
  connected: boolean
}

type StreamEvent = { type: 'connected' } | { type: 'step'; step: Step }

export function useSessionStream(sessionId: string | undefined): UseSessionStreamResult {
  const queryClient = useQueryClient()
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    if (!sessionId) return
    const queryKey = ['session', sessionId]
    const es = new EventSource(`/api/sessions/${sessionId}/stream`)

    es.onopen = () => setConnected(true)

    es.onmessage = (event) => {
      let payload: StreamEvent
      try {
        payload = JSON.parse(event.data) as StreamEvent
      } catch {
        return
      }
      if (payload.type === 'connected') return
      if (payload.type === 'step') {
        const step = payload.step
        queryClient.setQueryData<GetSessionResponse>(queryKey, (prev) => {
          if (!prev) return prev
          // Dedupe by id; replace existing entry if any.
          const others = prev.steps.filter((s) => s.id !== step.id)
          const next = [...others, step].sort((a, b) => a.startedAt.localeCompare(b.startedAt))
          return {
            ...prev,
            steps: next,
            session: { ...prev.session, stepCount: next.length },
          }
        })
      }
    }

    es.onerror = () => {
      // EventSource auto-reconnects with Last-Event-ID. We only need to flip
      // the visual indicator.
      setConnected(false)
    }

    return () => {
      es.close()
      setConnected(false)
    }
  }, [sessionId, queryClient])

  return { connected }
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @argus/web typecheck
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/use-session-stream.ts
git commit -m "feat(web): useSessionStream hook (EventSource + cache patch)"
```

---

## Task 6: Wire hook into session detail route + LIVE indicator in topbar

**Files:**

- Modify: `apps/web/src/routes/sessions/$sessionId.tsx`
- Modify: `apps/web/src/features/session-replay/index.tsx`
- Modify: `apps/web/src/features/session-replay/topbar/SessionTopbar.tsx`

- [ ] **Step 1: Modify `apps/web/src/routes/sessions/$sessionId.tsx`** — call `useSessionStream` and pass `connected` to `SessionReplay`. Replace the file with:

```tsx
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { fetchSession } from '../../lib/api'
import { useSessionStream } from '../../lib/use-session-stream'
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
  const stream = useSessionStream(sessionId)

  if (isLoading) return <div className="p-6 text-neutral-500">Loading…</div>
  if (error) return <div className="p-6 text-red-600">Error: {String(error)}</div>
  if (!data) return <div className="p-6">Not found</div>

  return (
    <SessionReplay
      session={data.session}
      steps={data.steps}
      activeStepId={search.step}
      activeTab={search.tab}
      connected={stream.connected}
      onSelectStep={(step) => navigate({ search: (prev) => ({ ...prev, step }), replace: true })}
      onSelectTab={(tab: TabKey) =>
        navigate({ search: (prev) => ({ ...prev, tab }), replace: true })
      }
    />
  )
}
```

- [ ] **Step 2: Modify `apps/web/src/features/session-replay/index.tsx`** — add `connected` prop, pass to topbar. Replace the file with:

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
  connected: boolean
  onSelectStep: (id: string) => void
  onSelectTab: (tab: TabKey) => void
}

export function SessionReplay({
  session,
  steps,
  activeStepId,
  activeTab,
  connected,
  onSelectStep,
  onSelectTab,
}: Props) {
  const activeStep = steps.find((s) => s.id === activeStepId) ?? steps[0]
  return (
    <div className="h-full flex flex-col">
      <SessionTopbar session={session} steps={steps} connected={connected} />
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

- [ ] **Step 3: Modify `apps/web/src/features/session-replay/topbar/SessionTopbar.tsx`** — add LIVE indicator. Replace the file with:

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
      className="inline-flex items-center gap-1 text-xs"
    >
      <span
        className={
          active
            ? 'inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse'
            : 'inline-block h-2 w-2 rounded-full bg-neutral-300'
        }
      />
      <span className={active ? 'text-emerald-700' : 'text-neutral-400'}>
        {active ? 'LIVE' : 'offline'}
      </span>
    </span>
  )
}

export function SessionTopbar({ session, steps, connected }: Props) {
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
          <LiveDot active={connected} />
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

- [ ] **Step 4: Typecheck + build**

```bash
pnpm --filter @argus/web typecheck
pnpm --filter @argus/web build
```

Expected: 0 errors; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/sessions/\$sessionId.tsx \
        apps/web/src/features/session-replay/index.tsx \
        apps/web/src/features/session-replay/topbar/SessionTopbar.tsx
git commit -m "feat(web): live SSE indicator + cache patching on step events"
```

---

## Task 7: End-to-end SSE integration test + M3 acceptance + tag

**Files:**

- Create: `apps/server/test/pusher/sse-integration.test.ts`

### Step 1: Write the integration test

This test actually starts a Fastify server on a random port, ingests an OTLP payload while an SSE connection is open, and parses the SSE stream to verify the step event arrived.

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import type { AddressInfo } from 'node:net'
import { ingestRoutes } from '../../src/modules/ingest/index.js'
import { pusherRoutes } from '../../src/modules/pusher/index.js'
import { PgStorage } from '../../src/modules/storage/pg.js'
import { InProcMessageBus } from '../../src/modules/pubsub/index.js'
import { createTestDb, truncateAll } from '../helpers/db.js'
import type { FastifyInstance } from 'fastify'

const HEX_TRACE = '0123456789abcdef0123456789abcdef'
const HEX_SPAN = 'aaaaaaaaaaaaaaaa'

function makeOtlpPayload() {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: 'argus.project', value: { stringValue: 'p1' } },
            { key: 'argus.service', value: { stringValue: 's1' } },
          ],
        },
        scopeSpans: [
          {
            spans: [
              {
                traceId: HEX_TRACE,
                spanId: HEX_SPAN,
                name: 'span.a',
                startTimeUnixNano: '1779955200000000000',
                endTimeUnixNano: '1779955201000000000',
              },
            ],
          },
        ],
      },
    ],
  }
}

describe('SSE end-to-end: POST /v1/traces -> session stream', () => {
  const db = createTestDb()
  const storage = new PgStorage(db)
  const bus = new InProcMessageBus()
  let app: FastifyInstance
  let port: number

  beforeAll(async () => {
    app = Fastify()
    await app.register(ingestRoutes, { storage, bus })
    await app.register(pusherRoutes, { storage, bus })
    await app.listen({ port: 0, host: '127.0.0.1' })
    port = (app.server.address() as AddressInfo).port
  })

  afterAll(async () => {
    bus.removeAllSubscribers()
    await app.close()
    await db.destroy()
  })

  beforeEach(async () => {
    await truncateAll(db)
  })

  it('publishes a step to a live SSE subscriber after ingest', async () => {
    // Pre-create the session by ingesting once.
    await fetch(`http://127.0.0.1:${port}/v1/traces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(makeOtlpPayload()),
    }).then(async (r) => {
      expect(r.status).toBe(200)
    })

    // Find the session id via storage (avoids depending on an API route).
    const [summary] = await storage.listSessions({
      orgId: '00000000-0000-0000-0000-000000000000',
    })
    expect(summary).toBeDefined()
    const sessionId = summary!.id

    // Open SSE.
    const controller = new AbortController()
    const ssePromise = fetch(`http://127.0.0.1:${port}/api/sessions/${sessionId}/stream`, {
      signal: controller.signal,
    })

    const sseRes = await ssePromise
    expect(sseRes.status).toBe(200)
    expect(sseRes.headers.get('content-type')).toMatch(/text\/event-stream/)
    const reader = sseRes.body!.getReader()
    const decoder = new TextDecoder()

    // Helper to read until we have at least one event terminator.
    async function readNextEvent(): Promise<string> {
      let buf = ''
      while (true) {
        const { value, done } = await reader.read()
        if (done) throw new Error('SSE stream ended prematurely')
        buf += decoder.decode(value, { stream: true })
        const idx = buf.indexOf('\n\n')
        if (idx >= 0) {
          const event = buf.slice(0, idx)
          return event
        }
      }
    }

    // First event from server is "connected".
    const connectedRaw = await readNextEvent()
    const connectedData = JSON.parse(connectedRaw.replace(/^data: /, ''))
    expect(connectedData).toEqual({ type: 'connected' })

    // Now send a SECOND ingest with a new span — should arrive over SSE.
    const second = makeOtlpPayload()
    second.resourceSpans[0]!.scopeSpans[0]!.spans[0]!.spanId = 'bbbbbbbbbbbbbbbb'
    await fetch(`http://127.0.0.1:${port}/v1/traces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(second),
    })

    // Read the next event — expect a step event for span 'bbbb...'.
    const stepEventRaw = await readNextEvent()
    const idLine = stepEventRaw.split('\n').find((l) => l.startsWith('id:'))!
    const dataLine = stepEventRaw.split('\n').find((l) => l.startsWith('data:'))!
    const data = JSON.parse(dataLine.replace(/^data: /, '')) as {
      type: string
      step: { spanId: string; id: string }
    }
    expect(data.type).toBe('step')
    expect(data.step.spanId).toBe('bbbbbbbbbbbbbbbb')
    expect(idLine).toBe(`id: ${data.step.id}`)

    controller.abort()
  }, 15_000)
})
```

- [ ] **Step 2: Run all tests**

```bash
pnpm --filter @argus/server test
```

Expected: PASS — 27 tests total (1 new integration + 26 from before).

If `fetch` is unavailable or behaves differently, verify Node version is 22+. If the integration test hangs, check that `app.close()` is being called in `afterAll`.

- [ ] **Step 3: Full pipeline acceptance**

```bash
rm -rf node_modules apps/*/node_modules packages/*/node_modules
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

All exits 0. Test counts:

- Server: 27 (4 pubsub + 4 sse-encoding + 1 sse-integration + 18 existing storage/parser/ingest/api/healthz)
- Web: 17

- [ ] **Step 4: Browser smoke (manual streaming verification)**

```bash
pnpm db:up
sleep 5
pnpm db:migrate
pnpm db:seed

DATABASE_URL=postgres://argus:argus@localhost:5432/argus pnpm dev > /tmp/argus.log 2>&1 &
DEV_PID=$!
sleep 8

# Get the seeded session id
SESSION_ID=$(curl -sf http://localhost:4000/api/sessions | python3 -c 'import sys,json; print(json.load(sys.stdin)["sessions"][0]["id"])')
echo "session id: $SESSION_ID"

# Open SSE and capture in background
( curl -sN --max-time 12 http://localhost:4000/api/sessions/$SESSION_ID/stream > /tmp/sse.log 2>&1 ) &
SSE_PID=$!

# Wait briefly so SSE handshake completes
sleep 2

# Push a new OTLP payload that targets the SAME session (same trace id from the seed)
# Use a fresh span id so we get a NEW step
NEW_SPAN=$(printf '%016x' $((RANDOM * RANDOM)))
NS=1779955210000000000

cat > /tmp/payload.json <<EOF
{
  "resourceSpans": [{
    "resource": {
      "attributes": [
        {"key": "argus.project", "value": {"stringValue": "demo"}},
        {"key": "argus.service", "value": {"stringValue": "weather-bot"}}
      ]
    },
    "scopeSpans": [{
      "spans": [{
        "traceId": "0123456789abcdef0123456789abcdef",
        "spanId": "$NEW_SPAN",
        "name": "live.update",
        "startTimeUnixNano": "$NS",
        "endTimeUnixNano": "$NS"
      }]
    }]
  }]
}
EOF

curl -sf -X POST http://localhost:4000/v1/traces \
  -H 'Content-Type: application/json' \
  --data-binary @/tmp/payload.json

sleep 4
kill $SSE_PID 2>/dev/null
wait $SSE_PID 2>/dev/null || true

echo "--- /tmp/sse.log ---"
cat /tmp/sse.log

kill $DEV_PID 2>/dev/null
wait $DEV_PID 2>/dev/null || true
pnpm db:down
```

Expected `/tmp/sse.log` content (truncated):

- `data: {"type":"connected"}` line
- One or more `id: <uuid>` + `data: {"type":"step","step":{...}}` lines
- The pushed span `live.update` appears as a step

> Browser part (cannot be automated in subagent): open http://localhost:5173 in a browser, navigate into the demo session, leave it open, then in another terminal run the same `curl POST /v1/traces`. The new step should appear in the timeline within ~1 second. The topbar shows a green pulsing `LIVE` dot while the page is open. This part is the visual M3 verification and the user does it after the subagent finishes the automated steps.

- [ ] **Step 5: Tag + push**

```bash
git tag -a m3-live-sse -m "M3 live SSE push complete

Acceptance:
- pnpm install/typecheck/lint/test/build all green (27 server + 17 web tests)
- In-proc MessageBus + InProcMessageBus + pub/sub tests
- writeTrace returns WriteTraceResult (sessionId + writtenSteps)
- SSE endpoint GET /api/sessions/:id/stream with reply.hijack(), Last-Event-ID replay, 15s heartbeat
- Ingest publishes API-shaped Step to bus after each writeTrace
- Web: useSessionStream hook opens EventSource, patches TanStack Query cache by appending steps
- Topbar shows pulsing green LIVE dot while connected; gray 'offline' when not
- End-to-end integration test: ingest -> bus -> SSE delivers step to subscriber
"
git push origin main
git push origin m3-live-sse
```

- [ ] **Step 6: Confirm CI green** at https://github.com/tiven-ai/Argus/actions.

---

## Acceptance Summary

M3 is complete when:

- [ ] `pnpm install` from clean state succeeds
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` all exit 0
- [ ] 27 server tests pass (4 pubsub + 4 sse-encode + 1 sse-integration + 18 existing) and 17 web tests pass
- [ ] Curl smoke test: an SSE subscriber receives a step event after a fresh `POST /v1/traces` (visible in `/tmp/sse.log`)
- [ ] Browser smoke (manual, user-performed): opening a session page shows a green pulsing `LIVE` dot; a new OTLP push appears as a new row in the timeline within ~1 second; topbar token / step counters update
- [ ] Tag `m3-live-sse` is created and pushed
- [ ] GitHub Actions on `main` is green

Once this lands, the next milestone is **M4 — Multi-tenant + public registration** (User / Organization model, login + cookie auth, ingest token CRUD, PG row-level security).
