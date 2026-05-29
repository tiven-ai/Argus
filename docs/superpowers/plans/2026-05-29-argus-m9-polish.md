# Argus M9 — Polish + Security Closeout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close out seven small leftovers from M3, M5a, M6, M7, M8 — SSE race fix, JWT session revocation on password reset, two periodic cleanup jobs (auth tokens + audit log), locale key-parity test, Intl wrapper for dates, and responsive session-detail layout.

**Architecture:** Each item is independent and bug-fix/hygiene shape — no shared infrastructure beyond reusing what M0–M8 already wired. Two new server modules (`auth-tokens/cleanup.ts`, `audit/cleanup.ts`) run as `setInterval` crons. A new schema column `users.password_version` plus a JWT `pv` claim invalidates old cookies on password reset. The SSE race is fixed by re-ordering subscribe before replay and de-duping via spanId. The web items add a `useLocaleFormat()` hook plus a `sm:` breakpoint on the session-detail grid.

**Tech Stack:** Existing — no new deps.

**Spec:** [docs/superpowers/specs/2026-05-29-argus-m9-polish-design.md](../specs/2026-05-29-argus-m9-polish-design.md)

---

## File Structure

```
apps/server/src/
├── db/
│   ├── migrations/
│   │   └── 0005_password_version.ts                (NEW)
│   └── schema.ts                                   (MODIFIED: Users.password_version)
├── env.ts                                          (MODIFIED: + TOKEN/AUDIT cleanup vars)
├── server.ts                                       (MODIFIED: cleanupDb opt + cron wiring)
├── main.ts                                         (MODIFIED: build cleanupDb pool + pass cron knobs)
└── modules/
    ├── auth-tokens/
    │   ├── cleanup.ts                              (NEW: cleanupExpiredTokens)
    │   └── index.ts                                (MODIFIED: re-export cleanup)
    ├── audit/
    │   ├── cleanup.ts                              (NEW: cleanupOldAuditLogs)
    │   └── index.ts                                (MODIFIED: re-export cleanup)
    ├── pusher/
    │   └── routes.ts                               (MODIFIED: SSE race fix)
    └── auth/
        ├── dao.ts                                  (MODIFIED: UserRecord.passwordVersion)
        ├── jwt.ts                                  (MODIFIED: pv claim)
        ├── middleware.ts                           (MODIFIED: verify pv)
        └── routes.ts                               (MODIFIED: password-reset bumps pv)

apps/server/test/
├── auth-tokens/
│   └── cleanup.test.ts                             (NEW)
├── audit/
│   └── cleanup.test.ts                             (NEW)
├── auth/
│   └── session-revocation.test.ts                  (NEW)
└── pusher/
    └── race.test.ts                                (NEW)

apps/web/src/
├── features/
│   └── session-replay/
│       └── index.tsx                               (MODIFIED: responsive grid)
├── i18n/
│   └── locale-parity.test.ts                       (NEW)
├── lib/
│   ├── use-locale-format.ts                        (NEW)
│   └── use-locale-format.test.tsx                  (NEW)
├── routes/
│   ├── sessions/index.tsx                          (MODIFIED: useLocaleFormat)
│   └── settings/tokens.tsx                         (MODIFIED: useLocaleFormat)

CLAUDE.md                                            (MODIFIED: cleanup-cron rule)
```

---

## Common Conventions

- Commits: Conventional Commits, lowercase subject (commitlint).
- TypeScript strict; `any` requires `// reason:` comment.
- No `--no-verify` / `--no-gpg-sign` on git.
- Pre-commit runs lint-staged (eslint + prettier). Commit may reformat the file.
- Cleanup tests use the super-user `createTestDb()` to bypass RLS during setup + assertion; the actual cleanup module is also called against the super-user DB (per spec: `audit_log` cleanup REQUIRES super-user; auth_one_time_tokens cleanup does not but uses the same pattern for consistency).
- Tests count after M9: ≥ 126 + 11 = 137 server; 14 + 4 = 18 web; ≥ 155 total.

---

## Task 1: Migration 0005 — `users.password_version` column

**Files:**

- Create: `apps/server/src/db/migrations/0005_password_version.ts`
- Modify: `apps/server/src/db/schema.ts`

### Step 1: Create the migration

```ts
import { type Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE users ADD COLUMN password_version int NOT NULL DEFAULT 1`.execute(db)
  // GRANT was set globally in 0003; this is belt-and-suspenders for fresh dev envs.
  await sql`GRANT UPDATE ON users TO argus_app`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE users DROP COLUMN IF EXISTS password_version`.execute(db)
}
```

### Step 2: Update `apps/server/src/db/schema.ts`

Add `password_version: Generated<number>` to the `Users` interface (between `email_verified_at` and `created_at`):

```ts
export interface Users {
  id: Generated<string>
  email: string
  password_hash: string
  email_verified_at: Timestamp | null
  password_version: Generated<number>
  created_at: Generated<Timestamp>
}
```

`Generated<number>` means inserts may omit it (uses DB default 1); reads return the actual number.

### Step 3: Run migration sanity test

```bash
pnpm db:up
sleep 5
pnpm --filter @argus/server test test/db-tenant/migration-roles.test.ts 2>&1 | tail -10
pnpm db:down
```

Expected: 4 tests still pass.

### Step 4: Commit

```bash
git add apps/server/src/db/migrations/0005_password_version.ts apps/server/src/db/schema.ts
git commit -m "feat(server): m9 migration 0005 — users.password_version"
```

---

## Task 2: JWT carries `pv`; middleware compares; UserRecord exposes `passwordVersion`

**Files:**

- Modify: `apps/server/src/modules/auth/jwt.ts`
- Modify: `apps/server/src/modules/auth/middleware.ts`
- Modify: `apps/server/src/modules/auth/dao.ts`
- Modify: `apps/server/src/modules/auth/routes.ts`

### Step 1: Read existing JWT module

```bash
cat apps/server/src/modules/auth/jwt.ts
```

You'll see something like `signJwt(payload: { userId: string }, secret, ttl)` and a verify counterpart.

### Step 2: Modify `apps/server/src/modules/auth/jwt.ts`

Change the payload shape to include `pv`:

```ts
import jwt from 'jsonwebtoken'

export interface SessionPayload {
  userId: string
  pv: number
}

export function signJwt(payload: SessionPayload, secret: string, ttlSeconds: number): string {
  return jwt.sign(payload, secret, { expiresIn: ttlSeconds })
}

export function verifyJwt(token: string, secret: string): SessionPayload | null {
  try {
    const decoded = jwt.verify(token, secret)
    if (typeof decoded !== 'object' || decoded === null) return null
    const obj = decoded as Record<string, unknown>
    if (typeof obj.userId !== 'string' || typeof obj.pv !== 'number') return null
    return { userId: obj.userId, pv: obj.pv }
  } catch {
    return null
  }
}
```

(If the existing signature uses different argument shape, mirror its convention — but the payload type MUST include `pv: number`. Read the file first.)

### Step 3: Modify `apps/server/src/modules/auth/dao.ts`

Update `UserRecord` to include `passwordVersion: number`:

```ts
export interface UserRecord {
  id: string
  email: string
  passwordHash: string
  orgId: string
  emailVerifiedAt: Date | null
  passwordVersion: number
}
```

Update `findUserByEmail`, `findUserById` selects to include `'u.password_version as passwordVersion'`. Each returned record carries the version.

`createUser` returns `passwordVersion: 1` (matches DB default).

`getLocalDefaultUser` fallback stub returns `passwordVersion: 1`.

### Step 4: Modify `apps/server/src/modules/auth/middleware.ts`

Read the file to find both call sites (multi-tenant + local). After `verifyJwt` returns a payload, look up the user and compare:

```ts
const payload = verifyJwt(token, deps.jwtSecret)
if (!payload) return null // bad signature / shape — existing behavior
const record = await findUserById(deps.db, payload.userId)
if (!record) return null
if (record.passwordVersion !== payload.pv) return null // <-- NEW: revoked cookie
request.auth = {
  user: {
    id: record.id,
    email: record.email,
    orgId: record.orgId,
    emailVerifiedAt: record.emailVerifiedAt?.toISOString() ?? null,
  },
}
```

(Exact integration depends on the existing middleware shape; the change is the `record.passwordVersion !== payload.pv` guard.)

### Step 5: Modify `apps/server/src/modules/auth/routes.ts`

Update every `signJwt` call site:

- `/auth/register` success: `signJwt({ userId: record.id, pv: record.passwordVersion }, jwtSecret, ttl)` — record carries `passwordVersion = 1` from DB default.
- `/auth/login` success: `signJwt({ userId: record.id, pv: record.passwordVersion }, jwtSecret, ttl)`.

There's a helper `setSessionCookie(reply, deps, userId)` — change its signature to take `passwordVersion`:

```ts
function setSessionCookie(reply, deps, userId: string, passwordVersion: number) {
  const token = signJwt({ userId, pv: passwordVersion }, deps.jwtSecret, deps.sessionTtlSeconds)
  reply.setCookie(deps.cookieName, token, { ... })  // existing options unchanged
}
```

Update call sites accordingly.

### Step 6: Run

```bash
pnpm db:up
sleep 5
pnpm --filter @argus/server typecheck 2>&1 | tail -15
pnpm --filter @argus/server test test/auth 2>&1 | tail -20
pnpm db:down
```

Expected: typecheck 0 errors; auth suite passes (existing tests build cookies via the updated helper).

### Step 7: Commit

```bash
git add apps/server/src/modules/auth/jwt.ts \
        apps/server/src/modules/auth/middleware.ts \
        apps/server/src/modules/auth/dao.ts \
        apps/server/src/modules/auth/routes.ts
git commit -m "feat(server): m9 JWT carries pv; middleware enforces password_version match"
```

---

## Task 3: Password-reset confirm bumps `password_version`; session-revocation test

**Files:**

- Modify: `apps/server/src/modules/auth/routes.ts`
- Create: `apps/server/test/auth/session-revocation.test.ts`

### Step 1: Modify the `/auth/password-reset/confirm` handler in `apps/server/src/modules/auth/routes.ts`

Inside the existing `deps.db.transaction().execute(...)` block, change the `users` UPDATE to ALSO bump `password_version`:

OLD:

```ts
await trx
  .updateTable('users')
  .set({ password_hash: newHash })
  .where('id', '=', found.userId)
  .execute()
```

NEW (inline `sql` expression for the increment):

```ts
import { sql } from 'kysely' // if not already imported
// ...
await trx
  .updateTable('users')
  .set({ password_hash: newHash, password_version: sql<number>`password_version + 1` })
  .where('id', '=', found.userId)
  .execute()
```

(Keep all other tx steps — the two existing `auth_one_time_tokens` updates remain.)

### Step 2: Create `apps/server/test/auth/session-revocation.test.ts`

Build the test using the same fixture pattern as `apps/server/test/auth/password-reset.test.ts` (read it for the harness shape):

```ts
import { describe, expect, test, beforeAll, afterAll, beforeEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import {
  authRoutes,
  resolveAuthContext,
  type AuthMiddlewareDeps,
} from '../../src/modules/auth/index.js'
import { dbTenantPlugin } from '../../src/modules/db-tenant/index.js'
import { MockEmailSender } from '../../src/modules/email/index.js'
import { createTestDb, createAppRoleTestDb, truncateAll } from '../helpers/db.js'

const JWT_SECRET = 'test-secret-at-least-32-chars-long-x'

describe('session revocation on password reset', () => {
  let app: FastifyInstance
  const admin = createTestDb()
  const appDb = createAppRoleTestDb()
  let sender: MockEmailSender

  beforeAll(async () => {
    app = Fastify()
    await app.register(cookie)
    await app.register(dbTenantPlugin, { db: appDb })
    sender = new MockEmailSender()
    const authDeps: AuthMiddlewareDeps = {
      db: appDb,
      mode: 'multi-tenant',
      cookieName: 'argus_session',
      jwtSecret: JWT_SECRET,
    }
    const authMiddleware = resolveAuthContext(authDeps)
    await app.register(authRoutes, {
      db: appDb,
      cookieName: 'argus_session',
      jwtSecret: JWT_SECRET,
      cookieSecure: false,
      sessionTtlSeconds: 3600,
      authMiddleware,
      emailSender: sender,
      appBaseUrl: 'http://localhost:5173',
    })
  })
  beforeEach(async () => {
    await truncateAll(admin)
    sender.sent.length = 0
  })
  afterAll(async () => {
    await app.close()
    await appDb.destroy()
    await admin.destroy()
  })

  test('old cookie returns 401 after password reset; new cookie works', async () => {
    // Register + capture cookie A.
    const reg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'revoke@test.com', password: 'oldpassword123' },
    })
    expect(reg.statusCode).toBe(200)
    const cookieA = reg.cookies[0]!
    const hdrA = `${cookieA.name}=${cookieA.value}`

    // Sanity: /auth/me works with cookie A.
    let me = await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie: hdrA } })
    expect(me.statusCode).toBe(200)

    // Request + confirm password reset.
    await app.inject({
      method: 'POST',
      url: '/auth/password-reset/request',
      payload: { email: 'revoke@test.com' },
    })
    const resetMsg = sender.sent.find((m) => m.subject.includes('Reset'))!
    const token = new URL(resetMsg.text.match(/http[^\s]+/)![0]).searchParams.get('token')!
    const confirm = await app.inject({
      method: 'POST',
      url: '/auth/password-reset/confirm',
      payload: { token, newPassword: 'newpassword99' },
    })
    expect(confirm.statusCode).toBe(200)

    // Cookie A should NOW be revoked.
    me = await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie: hdrA } })
    expect(me.statusCode).toBe(401)

    // Log in with the new password; cookie B works.
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'revoke@test.com', password: 'newpassword99' },
    })
    expect(login.statusCode).toBe(200)
    const cookieB = login.cookies[0]!
    const hdrB = `${cookieB.name}=${cookieB.value}`
    me = await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie: hdrB } })
    expect(me.statusCode).toBe(200)
    const body = JSON.parse(me.body)
    expect(body.user.email).toBe('revoke@test.com')
  })
})
```

### Step 3: Run

```bash
pnpm db:up
sleep 5
pnpm --filter @argus/server test test/auth 2>&1 | tail -20
pnpm db:down
```

Expected: all auth tests pass, including the new revocation test (1).

### Step 4: Commit

```bash
git add apps/server/src/modules/auth/routes.ts \
        apps/server/test/auth/session-revocation.test.ts
git commit -m "feat(server): m9 password reset bumps password_version + revocation test"
```

---

## Task 4: SSE reconnect-replay race fix

**Files:**

- Modify: `apps/server/src/modules/pusher/routes.ts`
- Create: `apps/server/test/pusher/race.test.ts`

### Step 1: Modify `apps/server/src/modules/pusher/routes.ts`

The current handler does `getSession()` → `bus.subscribe()`. Change to: subscribe first into a buffer, then read history, then drain. Dedup by `step.id`.

Replace the handler body (everything from `reply.hijack()` to the end of the route closure) with:

```ts
reply.hijack()
reply.raw.writeHead(200, {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
})

let replayDone = false
const buffer: Step[] = []
const seenIds = new Set<string>()

const handler: MessageHandler = (payload) => {
  const step = payload as Step
  if (!replayDone) {
    buffer.push(step)
    return
  }
  if (seenIds.has(step.id)) return
  seenIds.add(step.id)
  try {
    reply.raw.write(formatSseEvent(step.id, { type: 'step', step }))
  } catch {
    // socket closed; cleanup runs via 'close' below
  }
}
const unsubscribe = deps.bus.subscribe(`session:${sessionId}`, handler)

// Replay history (if reconnect with Last-Event-ID).
if (lastEventId) {
  const idx = detail.steps.findIndex((s) => s.id === lastEventId)
  const replay = idx >= 0 ? detail.steps.slice(idx + 1) : []
  for (const stored of replay) {
    const step = storedStepToApi(stored)
    seenIds.add(step.id)
    reply.raw.write(formatSseEvent(step.id, { type: 'step', step }))
  }
}
reply.raw.write(formatSseEvent(undefined, { type: 'connected' }))

// Drain buffered live events that arrived during replay.
replayDone = true
for (const step of buffer) {
  if (seenIds.has(step.id)) continue
  seenIds.add(step.id)
  try {
    reply.raw.write(formatSseEvent(step.id, { type: 'step', step }))
  } catch {
    // socket closed; cleanup runs via 'close' below
  }
}

const heartbeat = setInterval(() => {
  try {
    reply.raw.write(formatSseComment('heartbeat'))
  } catch {
    // ditto
  }
}, HEARTBEAT_INTERVAL_MS)

request.raw.on('close', () => {
  unsubscribe()
  clearInterval(heartbeat)
  try {
    reply.raw.end()
  } catch {
    // already ended
  }
})
```

Imports: `Step` is already imported from `@argus/shared-types`. `MessageHandler` is already imported.

### Step 2: Create `apps/server/test/pusher/race.test.ts`

This test uses a mock storage that pauses `getSession` until told to proceed; meanwhile we publish to the bus and assert exactly-once delivery on the SSE socket.

Read the existing `apps/server/test/pusher/sse-integration.test.ts` to understand the fixture shape (Fastify build + SSE client snippet). Then:

```ts
import { describe, expect, test, beforeAll, afterAll, beforeEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import { InProcMessageBus } from '../../src/modules/pubsub/index.js'
import type { StorageBackend } from '../../src/modules/storage/types.js'
import { pusherRoutes } from '../../src/modules/pusher/index.js'
import { dbTenantPlugin } from '../../src/modules/db-tenant/index.js'
import { resolveAuthContext, type AuthMiddlewareDeps } from '../../src/modules/auth/index.js'
import { createAppRoleTestDb } from '../helpers/db.js'

describe('SSE reconnect-replay race', () => {
  let app: FastifyInstance
  const appDb = createAppRoleTestDb()
  const bus = new InProcMessageBus()
  const sessionId = 'ssss0000-0000-0000-0000-00000000000a'
  const orgId = '00000000-0000-0000-0000-000000000000' // default org

  // Mock storage where getSession resolves on `gate`.
  let releaseGate: (() => void) | null = null
  const mockStorage: StorageBackend = {
    async writeTrace() {
      throw new Error('not used')
    },
    async listSessions() {
      return []
    },
    async getSession() {
      await new Promise<void>((resolve) => {
        releaseGate = resolve
      })
      return {
        id: sessionId,
        traceId: 'trace',
        projectName: 'p',
        serviceName: 's',
        startedAt: new Date(),
        endedAt: null,
        stepCount: 0,
        steps: [],
      }
    },
  }

  beforeAll(async () => {
    app = Fastify()
    await app.register(cookie)
    await app.register(dbTenantPlugin, { db: appDb })
    const authDeps: AuthMiddlewareDeps = {
      db: appDb,
      mode: 'local',
      cookieName: 'argus_session',
      jwtSecret: 'x'.repeat(32),
    }
    const authMiddleware = resolveAuthContext(authDeps)
    await app.register(
      async (scope) => {
        scope.addHook('preHandler', authMiddleware)
        await scope.register(pusherRoutes, { storage: mockStorage, bus })
      },
      { prefix: '' },
    )
    await app.ready()
  })
  beforeEach(() => {
    releaseGate = null
  })
  afterAll(async () => {
    await app.close()
    await appDb.destroy()
  })

  test('step published during getSession is delivered exactly once', async () => {
    // Start the SSE request — getSession will block on `releaseGate`.
    const responsePromise = app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/stream`,
    })

    // Give Fastify a tick to enter the handler and subscribe to bus.
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))

    // Publish a step while getSession is still pending — subscribe MUST have happened by now.
    const step = {
      id: 'step-during-replay',
      sessionId,
      spanId: 'sp1',
      parentSpanId: null,
      name: 'op',
      kind: null,
      componentType: null,
      componentName: null,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      attributes: {},
      statusCode: 'OK',
      statusMessage: null,
      events: [],
    }
    bus.publish(`session:${sessionId}`, step)

    // Now release getSession.
    if (!releaseGate) throw new Error('getSession was not called yet')
    releaseGate!()

    const response = await responsePromise
    const body = response.body
    // Count occurrences of step-during-replay in the SSE stream.
    const matches = body.match(/step-during-replay/g) ?? []
    expect(matches.length).toBe(1)
  })
})
```

> NOTE: The test uses `app.inject` which buffers the streaming body until the connection closes. For SSE the connection stays open until we explicitly stop. To force closure, the test relies on `app.close()` in `afterAll`. If `app.inject` hangs in your environment, fall back to: open an `IncomingMessage` over a `getPort()` HTTP server (the existing `sse-integration.test.ts` shows this pattern). Use whichever the existing harness uses.

### Step 3: Run

```bash
pnpm db:up
sleep 5
pnpm --filter @argus/server test test/pusher 2>&1 | tail -25
pnpm db:down
```

Expected: existing pusher tests still pass; new race test passes (1 new test).

### Step 4: Commit

```bash
git add apps/server/src/modules/pusher/routes.ts apps/server/test/pusher/race.test.ts
git commit -m "fix(server): m9 SSE subscribe-then-replay-then-drain; dedup by step.id"
```

---

## Task 5: `auth-tokens/cleanup.ts` + 3 tests

**Files:**

- Create: `apps/server/src/modules/auth-tokens/cleanup.ts`
- Modify: `apps/server/src/modules/auth-tokens/index.ts`
- Create: `apps/server/test/auth-tokens/cleanup.test.ts`

### Step 1: Create `apps/server/src/modules/auth-tokens/cleanup.ts`

```ts
import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import type { DB } from '../../db/schema.js'

/**
 * Delete tokens that are either:
 *   - consumed and older than 30 days, OR
 *   - unconsumed and expired more than 1 day ago.
 * Returns the count deleted.
 */
export async function cleanupExpiredTokens(db: Kysely<DB>): Promise<{ deleted: number }> {
  const result = await db
    .deleteFrom('auth_one_time_tokens')
    .where((eb) =>
      eb.or([
        eb.and([
          eb('consumed_at', 'is not', null),
          sql<boolean>`consumed_at < now() - interval '30 days'`,
        ]),
        eb.and([
          eb('consumed_at', 'is', null),
          sql<boolean>`expires_at < now() - interval '1 day'`,
        ]),
      ]),
    )
    .executeTakeFirst()
  return { deleted: Number(result.numDeletedRows ?? 0) }
}
```

### Step 2: Re-export from `apps/server/src/modules/auth-tokens/index.ts`

Add `export * from './cleanup.js'` at the bottom.

### Step 3: Create `apps/server/test/auth-tokens/cleanup.test.ts`

```ts
import { describe, expect, test, beforeAll, afterAll, beforeEach } from 'vitest'
import { sql } from 'kysely'
import { cleanupExpiredTokens } from '../../src/modules/auth-tokens/index.js'
import { createTestDb, truncateAll } from '../helpers/db.js'

const USER_A = '11111111-1111-1111-1111-111111111111'

describe('cleanupExpiredTokens', () => {
  const db = createTestDb()
  beforeAll(async () => {
    // local user is seeded by 0002 migration.
  })
  beforeEach(async () => {
    await truncateAll(db)
    await sql`TRUNCATE TABLE auth_one_time_tokens`.execute(db)
    await sql`INSERT INTO users (id, email, password_hash) VALUES (${USER_A}, 'c@test.com', '$x$') ON CONFLICT DO NOTHING`.execute(
      db,
    )
  })
  afterAll(async () => {
    await db.destroy()
  })

  async function insertToken(args: {
    userId: string
    kind: 'email_verify' | 'password_reset'
    tokenHash: string
    expiresAt: string // SQL interval
    consumedAt: string | null
    createdAt: string
  }) {
    await sql`
      INSERT INTO auth_one_time_tokens (user_id, kind, token_hash, expires_at, consumed_at, created_at)
      VALUES (
        ${args.userId},
        ${args.kind},
        ${args.tokenHash},
        now() + ${sql.raw(args.expiresAt)},
        ${args.consumedAt ? sql.raw(`now() + ${args.consumedAt}`) : null},
        now() + ${sql.raw(args.createdAt)}
      )
    `.execute(db)
  }

  test('deletes consumed >30 days and unconsumed-expired >1 day; returns count 2', async () => {
    // Old consumed (31 days old consumed_at)
    await insertToken({
      userId: USER_A,
      kind: 'email_verify',
      tokenHash: 'hash-old-consumed',
      expiresAt: "interval '-29 days'",
      consumedAt: "interval '-31 days'",
      createdAt: "interval '-31 days'",
    })
    // Expired more than 1 day ago, unconsumed
    await insertToken({
      userId: USER_A,
      kind: 'password_reset',
      tokenHash: 'hash-old-expired',
      expiresAt: "interval '-2 days'",
      consumedAt: null,
      createdAt: "interval '-2 days'",
    })
    // Fresh: unconsumed + not expired
    await insertToken({
      userId: USER_A,
      kind: 'email_verify',
      tokenHash: 'hash-fresh',
      expiresAt: "interval '+1 day'",
      consumedAt: null,
      createdAt: "interval '0'",
    })

    const result = await cleanupExpiredTokens(db)
    expect(result.deleted).toBe(2)
    const remaining = await db.selectFrom('auth_one_time_tokens').select('token_hash').execute()
    expect(remaining.map((r) => r.token_hash)).toEqual(['hash-fresh'])
  })

  test('expired 12h ago in grace window — not deleted', async () => {
    await insertToken({
      userId: USER_A,
      kind: 'email_verify',
      tokenHash: 'hash-grace',
      expiresAt: "interval '-12 hours'",
      consumedAt: null,
      createdAt: "interval '-12 hours'",
    })
    const result = await cleanupExpiredTokens(db)
    expect(result.deleted).toBe(0)
  })

  test('returns 0 when table is empty', async () => {
    const result = await cleanupExpiredTokens(db)
    expect(result.deleted).toBe(0)
  })
})
```

### Step 4: Run

```bash
pnpm db:up
sleep 5
pnpm --filter @argus/server test test/auth-tokens 2>&1 | tail -20
pnpm db:down
```

Expected: 3 new tests pass; existing M8-2 auth-tokens tests still pass.

### Step 5: Commit

```bash
git add apps/server/src/modules/auth-tokens/cleanup.ts \
        apps/server/src/modules/auth-tokens/index.ts \
        apps/server/test/auth-tokens/cleanup.test.ts
git commit -m "feat(server): m9 auth-tokens cleanup — expired + old-consumed delete"
```

---

## Task 6: `audit/cleanup.ts` + 2 tests

**Files:**

- Create: `apps/server/src/modules/audit/cleanup.ts`
- Modify: `apps/server/src/modules/audit/index.ts`
- Create: `apps/server/test/audit/cleanup.test.ts`

### Step 1: Create `apps/server/src/modules/audit/cleanup.ts`

```ts
import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import type { DB } from '../../db/schema.js'

/**
 * Delete audit_log rows older than `retentionDays` days. Returns the count.
 * Pass the super-user `cleanupDb` pool — `audit_log` is under RLS, and the
 * argus_app role's DELETE evaluates the policy USING clause (which expects
 * a current_setting('argus.current_org_id') and would refuse the global sweep).
 *
 * No-op when retentionDays <= 0.
 */
export async function cleanupOldAuditLogs(
  db: Kysely<DB>,
  retentionDays: number,
): Promise<{ deleted: number }> {
  if (retentionDays <= 0) return { deleted: 0 }
  const result = await db
    .deleteFrom('audit_log')
    .where(
      sql<boolean>`timestamp < now() - (${sql.raw(String(retentionDays))} || ' days')::interval`,
    )
    .executeTakeFirst()
  return { deleted: Number(result.numDeletedRows ?? 0) }
}
```

### Step 2: Re-export from `apps/server/src/modules/audit/index.ts`

Add `export * from './cleanup.js'` at the bottom.

### Step 3: Create `apps/server/test/audit/cleanup.test.ts`

```ts
import { describe, expect, test, beforeAll, afterAll, beforeEach } from 'vitest'
import { sql } from 'kysely'
import { cleanupOldAuditLogs } from '../../src/modules/audit/index.js'
import { createTestDb, truncateAll } from '../helpers/db.js'

const USER_A = '11111111-1111-1111-1111-111111111111'
const ORG_DEFAULT = '00000000-0000-0000-0000-000000000000'

describe('cleanupOldAuditLogs', () => {
  const db = createTestDb()
  beforeAll(async () => {
    // local user + default org are seeded by 0002.
  })
  beforeEach(async () => {
    await truncateAll(db)
  })
  afterAll(async () => {
    await db.destroy()
  })

  test('deletes rows older than retentionDays; keeps newer ones', async () => {
    // Three rows: 100 days, 31 days, 1 day old.
    await sql`
      INSERT INTO audit_log (org_id, actor_user_id, event_type, timestamp)
      VALUES
        (${ORG_DEFAULT}, ${USER_A}, 'login_success', now() - interval '100 days'),
        (${ORG_DEFAULT}, ${USER_A}, 'login_success', now() - interval '31 days'),
        (${ORG_DEFAULT}, ${USER_A}, 'login_success', now() - interval '1 day')
    `.execute(db)

    const result = await cleanupOldAuditLogs(db, 90)
    expect(result.deleted).toBe(1)
    const rows = await db.selectFrom('audit_log').selectAll().execute()
    expect(rows).toHaveLength(2)
  })

  test('retentionDays = 0 is a no-op', async () => {
    await sql`
      INSERT INTO audit_log (org_id, actor_user_id, event_type, timestamp)
      VALUES (${ORG_DEFAULT}, ${USER_A}, 'login_success', now() - interval '100 days')
    `.execute(db)
    const result = await cleanupOldAuditLogs(db, 0)
    expect(result.deleted).toBe(0)
    const rows = await db.selectFrom('audit_log').selectAll().execute()
    expect(rows).toHaveLength(1)
  })
})
```

### Step 4: Run

```bash
pnpm db:up
sleep 5
pnpm --filter @argus/server test test/audit 2>&1 | tail -20
pnpm db:down
```

Expected: 2 new tests pass; existing audit tests still pass.

### Step 5: Commit

```bash
git add apps/server/src/modules/audit/cleanup.ts \
        apps/server/src/modules/audit/index.ts \
        apps/server/test/audit/cleanup.test.ts
git commit -m "feat(server): m9 audit_log cleanup — retention-day sweep"
```

---

## Task 7: env vars + `cleanupDb` opt + cron wiring in `main.ts`

**Files:**

- Modify: `apps/server/src/env.ts`
- Modify: `apps/server/src/server.ts`
- Modify: `apps/server/src/main.ts`
- Modify: `apps/server/test/healthz.test.ts` (if needed for new opts)

### Step 1: Modify `apps/server/src/env.ts`

Add cleanup-cron env vars:

```ts
TOKEN_CLEANUP_INTERVAL_MS: z.coerce.number().int().min(0).default(60 * 60 * 1000),
AUDIT_CLEANUP_INTERVAL_MS: z.coerce.number().int().min(0).default(60 * 60 * 1000),
AUDIT_RETENTION_DAYS: z.coerce.number().int().min(0).default(90),
```

### Step 2: Modify `apps/server/src/server.ts`

Add optional `cleanupDb` and the three cron knobs to `ServerOptions`:

```ts
export interface ServerOptions {
  databaseUrl: string
  appDatabaseUrl: string
  // …existing fields…
  /** Super-user pool for cleanup crons. If not provided, crons are skipped. */
  cleanupDb?: Kysely<DB>
  tokenCleanupIntervalMs?: number
  auditCleanupIntervalMs?: number
  auditRetentionDays?: number
}
```

Inside `createServer`, after `app.addHook('onClose', …)`, install the cron timers:

```ts
import { cleanupExpiredTokens } from './modules/auth-tokens/index.js'
import { cleanupOldAuditLogs } from './modules/audit/index.js'

const timers: NodeJS.Timeout[] = []
if (opts.tokenCleanupIntervalMs && opts.tokenCleanupIntervalMs > 0) {
  const t = setInterval(() => {
    cleanupExpiredTokens(db).catch((err) =>
      app.log.warn({ err, event: 'token_cleanup_failed' }, 'token cleanup failed'),
    )
  }, opts.tokenCleanupIntervalMs)
  t.unref()
  timers.push(t)
}
if (
  opts.cleanupDb &&
  opts.auditCleanupIntervalMs &&
  opts.auditCleanupIntervalMs > 0 &&
  opts.auditRetentionDays !== undefined
) {
  const cleanupDb = opts.cleanupDb
  const days = opts.auditRetentionDays
  const t = setInterval(() => {
    cleanupOldAuditLogs(cleanupDb, days).catch((err) =>
      app.log.warn({ err, event: 'audit_cleanup_failed' }, 'audit cleanup failed'),
    )
  }, opts.auditCleanupIntervalMs)
  t.unref()
  timers.push(t)
}
// In the existing onClose hook, also clear the timers.
app.addHook('onClose', async () => {
  for (const t of timers) clearInterval(t)
})
```

(If there's already an onClose hook for `bus.removeAllSubscribers + db.destroy`, append the `clearInterval` loop to it.)

### Step 3: Modify `apps/server/src/main.ts`

Build the super-user `cleanupDb` and pass cron knobs through:

```ts
import { createKysely } from './db/kysely.js'
// …existing imports…

async function main() {
  const env = loadEnv()
  const cleanupDb = createKysely(env.DATABASE_URL) // super-user pool

  const { app, db, bus } = await createServer({
    databaseUrl: env.DATABASE_URL,
    appDatabaseUrl: env.APP_DATABASE_URL!,
    // …existing fields…
    cleanupDb,
    tokenCleanupIntervalMs: env.TOKEN_CLEANUP_INTERVAL_MS,
    auditCleanupIntervalMs: env.AUDIT_CLEANUP_INTERVAL_MS,
    auditRetentionDays: env.AUDIT_RETENTION_DAYS,
  })

  // …existing listen / grpc start / shutdown…
}
```

Make sure `cleanupDb` is destroyed on shutdown:

```ts
const shutdown = async () => {
  app.log.info('Shutting down…')
  await Promise.all([app.close(), grpc?.close() ?? Promise.resolve()])
  await cleanupDb.destroy()
  process.exit(0)
}
```

### Step 4: Modify `apps/server/test/healthz.test.ts` if needed

If the existing test constructs `ServerOptions` from raw env-derived fields, the new optional fields don't need to be passed (their defaults / undefined cause the crons to skip). Read the test to verify; only add fields if typecheck demands.

### Step 5: Run

```bash
pnpm db:up
sleep 5
pnpm --filter @argus/server typecheck 2>&1 | tail -10
pnpm --filter @argus/server test 2>&1 | tail -20
pnpm db:down
```

Expected: typecheck 0 errors; full server suite green.

### Step 6: Commit

```bash
git add apps/server/src/env.ts apps/server/src/server.ts apps/server/src/main.ts \
        apps/server/test/healthz.test.ts
git commit -m "feat(server): m9 cleanup cron wiring — cleanupDb + setInterval"
```

---

## Task 8: Locale key parity vitest (web)

**Files:**

- Create: `apps/web/src/i18n/locale-parity.test.ts`

### Step 1: Create the test

```ts
import { describe, expect, test } from 'vitest'
import en from './locales/en.json'
import zhCN from './locales/zh-CN.json'
import ja from './locales/ja.json'

function flatten(o: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(o).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k
    return v && typeof v === 'object' ? flatten(v as Record<string, unknown>, key) : [key]
  })
}

describe('locale parity', () => {
  const enKeys = new Set(flatten(en as Record<string, unknown>))
  test('zh-CN matches en key set', () => {
    expect(new Set(flatten(zhCN as Record<string, unknown>))).toEqual(enKeys)
  })
  test('ja matches en key set', () => {
    expect(new Set(flatten(ja as Record<string, unknown>))).toEqual(enKeys)
  })
})
```

### Step 2: Run

```bash
pnpm --filter @argus/web test 2>&1 | tail -15
```

Expected: 2 new tests pass; web test total = 14 + 2 = 16.

### Step 3: Commit

```bash
git add apps/web/src/i18n/locale-parity.test.ts
git commit -m "test(web): m9 locale key parity vitest"
```

---

## Task 9: `useLocaleFormat()` hook + replace `toLocaleString()` call sites

**Files:**

- Create: `apps/web/src/lib/use-locale-format.ts`
- Create: `apps/web/src/lib/use-locale-format.test.tsx`
- Modify: `apps/web/src/routes/sessions/index.tsx`
- Modify: `apps/web/src/routes/settings/tokens.tsx`

### Step 1: Create the hook

```ts
// apps/web/src/lib/use-locale-format.ts
import { useTranslation } from 'react-i18next'
import { useMemo } from 'react'

export function useLocaleFormat() {
  const { i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const dateTimeFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
    [locale],
  )
  const numberFmt = useMemo(() => new Intl.NumberFormat(locale), [locale])
  return {
    dateTime: (d: Date) => dateTimeFmt.format(d),
    number: (n: number) => numberFmt.format(n),
  }
}
```

### Step 2: Replace call sites

**`apps/web/src/routes/sessions/index.tsx`** — find the row:

```tsx
<td className="px-3 py-2 text-text-3 tabular">{new Date(s.startedAt).toLocaleString()}</td>
```

Replace with:

```tsx
<td className="px-3 py-2 text-text-3 tabular">{f.dateTime(new Date(s.startedAt))}</td>
```

And at the top of the `SessionsList` component body add:

```tsx
const f = useLocaleFormat()
```

Import: `import { useLocaleFormat } from '../../lib/use-locale-format'`

**`apps/web/src/routes/settings/tokens.tsx`** — find:

```tsx
<td className="px-3 py-2 text-text-3 tabular">{new Date(tok.createdAt).toLocaleString()}</td>
```

Replace with the same pattern (`useLocaleFormat` hook + `f.dateTime(...)`). Import the hook at the top.

### Step 3: Create the test

```tsx
// apps/web/src/lib/use-locale-format.test.tsx
import { describe, expect, test } from 'vitest'
import { renderHook } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import i18n from '../i18n'
import { useLocaleFormat } from './use-locale-format'

describe('useLocaleFormat', () => {
  test('en and zh-CN format dates differently', async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
    )

    await i18n.changeLanguage('en')
    const en = renderHook(() => useLocaleFormat(), { wrapper })
    const d = new Date('2026-05-29T10:30:00Z')
    const enFormatted = en.result.current.dateTime(d)

    await i18n.changeLanguage('zh-CN')
    const zh = renderHook(() => useLocaleFormat(), { wrapper })
    const zhFormatted = zh.result.current.dateTime(d)

    // The two locales should produce different formatted output for the same input.
    expect(enFormatted).not.toBe(zhFormatted)
    expect(enFormatted.length).toBeGreaterThan(0)
    expect(zhFormatted.length).toBeGreaterThan(0)
  })

  test('number formatting respects locale', async () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
    )
    await i18n.changeLanguage('en')
    const en = renderHook(() => useLocaleFormat(), { wrapper })
    expect(en.result.current.number(1234567)).toBe('1,234,567')
  })
})
```

> **Possible dep**: `@testing-library/react` must be installed. If not present in `apps/web/package.json`, install via:
>
> ```
> cd /Users/fooevr/Code/argus && pnpm add -D --filter @argus/web @testing-library/react @testing-library/dom @types/react
> ```
>
> Plus the test env needs jsdom. Check `apps/web/vite.config.ts` for an existing `test.environment`. If absent, add `test: { environment: 'jsdom' }` to vite config; install `jsdom` as a dev dep on @argus/web. (M6 added `step-helpers.test.ts` + `compute-rounds.test.ts` which run pure node — no DOM. The new hook test is the first DOM test.)
>
> **Simpler fallback**: skip `renderHook` and test the hook by manually calling `Intl.DateTimeFormat(locale, ...)` from a plain test — this verifies the deterministic locale-formatting layer without needing React. The hook is a thin wrapper; the underlying behavior is `Intl.*`.
>
> Recommend: use the plain test fallback first (simpler), and only add DOM-test infra if the team wants component coverage in the future. Replacement test:
>
> ```ts
> import { describe, expect, test } from 'vitest'
>
> describe('Intl.DateTimeFormat (underlying useLocaleFormat behavior)', () => {
>   test('en and zh-CN produce different formatted output for same date', () => {
>     const d = new Date('2026-05-29T10:30:00Z')
>     const en = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(
>       d,
>     )
>     const zh = new Intl.DateTimeFormat('zh-CN', {
>       dateStyle: 'medium',
>       timeStyle: 'short',
>     }).format(d)
>     expect(en).not.toBe(zh)
>   })
>   test('Intl.NumberFormat en groups thousands with comma', () => {
>     expect(new Intl.NumberFormat('en').format(1234567)).toBe('1,234,567')
>   })
> })
> ```
>
> Save this as `apps/web/src/lib/use-locale-format.test.ts` (note: `.test.ts`, no jsx). This avoids the DOM-test infra dep entirely. The hook itself is small enough to be visually verified — its only logic is wrapping Intl with `useMemo`.

### Step 4: Run

```bash
pnpm --filter @argus/web typecheck
pnpm --filter @argus/web test 2>&1 | tail -15
pnpm --filter @argus/web build 2>&1 | tail -5
```

Expected: typecheck clean; ≥ 2 new tests pass; web total ≥ 16 + 2 = 18; build succeeds.

### Step 5: Commit

```bash
git add apps/web/src/lib/use-locale-format.ts apps/web/src/lib/use-locale-format.test.ts \
        apps/web/src/routes/sessions/index.tsx apps/web/src/routes/settings/tokens.tsx
git commit -m "feat(web): m9 useLocaleFormat hook + replace toLocaleString call sites"
```

---

## Task 10: Session-detail responsive layout

**Files:**

- Modify: `apps/web/src/features/session-replay/index.tsx`

### Step 1: Modify the grid container

Find the JSX:

```tsx
<div className="flex-1 grid grid-cols-[380px_1fr] overflow-hidden">
  <aside className="border-r border-hairline overflow-hidden">
    <RoundTimeline ... />
  </aside>
  <main className="overflow-hidden">
    {activeRound ? (...) : (...)}
  </main>
</div>
```

Replace classes:

```tsx
<div className="flex-1 grid grid-cols-1 grid-rows-[1fr_1fr] sm:grid-rows-1 sm:grid-cols-[minmax(280px,360px)_1fr] overflow-hidden">
  <aside className="border-b sm:border-b-0 sm:border-r border-hairline overflow-hidden">
    <RoundTimeline ... />
  </aside>
  <main className="overflow-hidden">
    {activeRound ? (...) : (...)}
  </main>
</div>
```

### Step 2: Visual smoke

(After all server + web pieces land — done in T11 by the controller.) Open the app via Claude Preview and resize to 320 / 480 / 640 / 1200. Confirm stack-then-side-by-side transition.

### Step 3: Run

```bash
pnpm --filter @argus/web typecheck
pnpm --filter @argus/web build 2>&1 | tail -5
```

Expected: 0 errors; build clean.

### Step 4: Commit

```bash
git add apps/web/src/features/session-replay/index.tsx
git commit -m "feat(web): m9 responsive session-detail layout (stack < 640px)"
```

---

## Task 11: CLAUDE.md + final pipeline + tag m9-polish

**Files:**

- Modify: `/Users/fooevr/Code/argus/CLAUDE.md`

### Step 1: Update CLAUDE.md

Append to "Common pitfalls":

```
- **Background cleanup cron jobs use the super-user `cleanupDb` pool, not `argus_app`.** `audit_log` is under RLS; without `SET LOCAL argus.current_org_id` cron-style DELETEs land on `0 rows`. The super-user connection bypasses RLS and runs the DELETE globally.
```

Append to "Working rules":

```
- **Adding a recurring server-side maintenance task:** put it in `apps/server/src/modules/<module>/cleanup.ts` as a pure async function over a `Kysely<DB>` (no Fastify decorator). Wire in `main.ts` via `setInterval(...).unref()` gated on an env-var interval (0 = disabled). Cron-style tasks DO NOT register Fastify routes.
```

### Step 2: Full pipeline

```bash
pnpm db:up
sleep 5
pnpm typecheck
pnpm lint
pnpm test
pnpm db:down
pnpm build
```

Expected: all exit 0. Server tests ≥ 126 + 7 = 133. Web tests 14 + 4 = 18.

### Step 3: Commit + tag

```bash
git add CLAUDE.md
git commit -m "docs(claude): m9 cleanup-cron + super-user pool rules"

git tag -a m9-polish -m "M9 polish + security closeout

- SSE reconnect-replay race fixed (subscribe-then-replay-then-drain)
- JWT carries pv claim; users.password_version invalidates old cookies
- auth_one_time_tokens cleanup cron (consumed >30d, expired >1d)
- audit_log retention cron (default 90 days; super-user pool)
- locale key parity vitest catches en/zh-CN/ja drift
- useLocaleFormat hook replaces toLocaleString at 2 sites
- session-detail responsive layout (single-column < 640px)
- ~145 tests pass; M9 adds 11 new (1 race + 1 revocation + 3 token cleanup + 2 audit cleanup + 2 locale parity + 2 Intl)
"

git push origin main 2>&1 | tail -10
git push origin m9-polish 2>&1 | tail -5
```

### Step 4: Visual smoke (controller)

Via Claude Preview:

- Resize session-detail to 320 / 480 / 640 / 1200 — confirm layout flips at 640px.
- Switch language to zh-CN on sessions list — confirm date format changes.
- (Cron smoke: not visible in browser — trusted via tests.)

### Step 5: Confirm CI green at https://github.com/tiven-ai/Argus/actions

---

## Acceptance Summary

M9 is done when:

- [ ] `pnpm install / typecheck / lint / test / build` all exit 0
- [ ] All M8 tests (126 server + 14 web) still pass; M9 adds 11 new
- [ ] `users.password_version` column exists; JWT carries `pv`; middleware enforces
- [ ] `cleanupExpiredTokens(db)` + `cleanupOldAuditLogs(db, days)` modules exist with unit tests
- [ ] `setInterval(...).unref()` crons wired in `createServer`, gated on env-var interval > 0
- [ ] SSE race test passes — published-during-replay step is delivered exactly once
- [ ] Locale parity test fails if any en key is missing in zh-CN/ja
- [ ] `useLocaleFormat()` hook replaces 2 `toLocaleString()` sites; en vs zh-CN produce different output
- [ ] Session-detail page stacks below 640px, side-by-side at and above
- [ ] CLAUDE.md updated with cron-pool rule
- [ ] Tag `m9-polish` pushed; CI green

Once M9 lands, M0–M9 is engineering-stable. Next bigger work: M10 multi-org/multi-member and M11 email body i18n.
