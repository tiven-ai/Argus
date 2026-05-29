# Argus M9 — Polish + Security Closeout (Design Spec)

**Status:** approved 2026-05-29
**Predecessors:** [M0–M6](2026-05-28-argus-design.md), [M7 RLS + audit](2026-05-29-argus-m7-rls-audit-design.md), [M8 email flows](2026-05-29-argus-m8-email-flows-design.md)
**Goal:** Close out seven small leftovers carried by prior milestones, all bug-fix or hygiene work that shares no common infrastructure. After M9 the M0–M9 build is the engineering-stable baseline before bigger features (M10 multi-org, M11 email i18n) land.

---

## 1. Scope

Seven items, independent:

1. **SSE reconnect-replay race** (M3 leftover): order subscribe-then-replay-then-drain so a step published between `getSession()` and `bus.subscribe()` is not lost.
2. **JWT session revocation on password reset** (M8 leftover): new `users.password_version` column; JWT payload carries `pv`; middleware compares; password-reset confirm bumps.
3. **auth_one_time_tokens cleanup cron** (M8 leftover): periodic delete of expired-unconsumed and old-consumed rows.
4. **audit_log retention cron** (M7 leftover): periodic delete of rows older than configurable retention window.
5. **Locale key parity vitest** (M6 leftover): test that en/zh-CN/ja have matching key sets.
6. **Intl wrapper for dates/numbers** (M6 leftover): `useLocaleFormat()` hook to replace `toLocaleString()` calls so dates respect the active i18n language.
7. **Session-detail responsive layout** (M5a leftover): single-column stack below 640px instead of cramping the 380px sidebar.

### Out (Non-Goals)

- `login_failure` rows in `audit_log` (user chose to keep them in pino app log; revisit if compliance demands).
- Email body i18n (M11).
- Server-side error message i18n.
- Audit log UI viewer / HTTP API.
- Multi-org / multi-member (M10).
- Token cleanup retention beyond the simple time-window thresholds (no per-org limits, no soft delete).

## 2. Success Criteria

M9 is done when all hold:

1. SSE reconnect test proves: a step published while the server is mid-`getSession()` reaches the reconnecting client exactly once (no loss, no duplicate).
2. After `/auth/password-reset/confirm` succeeds, requests bearing the old cookie return 401 at `/auth/me`. Login with the new password returns a fresh cookie carrying the new `pv`.
3. `cleanupExpiredTokens(db)` deletes rows matching the time windows. `cleanupOldAuditLogs(db, days)` deletes rows older than `days`. Both have unit tests and are wired in `main.ts` via `setInterval`.
4. `apps/web/src/i18n/locale-parity.test.ts` runs in `pnpm test` and fails if any locale gains or loses a key.
5. `useLocaleFormat().dateTime(d)` is called from all four date-render sites currently using `toLocaleString()`; ja and zh-CN renders differ visibly from en.
6. Resizing the session-detail page to ≤640px stacks timeline above detail (each ~50% viewport height); above 640px the existing two-column layout returns.
7. CI: existing M8 tests still pass; M9 adds ≥8 new tests across server + web.

## 3. Item-by-item Design

### 3.1 SSE reconnect-replay race

**File**: `apps/server/src/modules/pusher/routes.ts` (the SSE handler).

Current shape:

```ts
const detail = await deps.storage.getSession(...)   // (1) read history
// ... emit historical steps to client ...
deps.bus.subscribe(channel, (m) => reply.raw.write(m))  // (2) subscribe
```

Window: step ingested between (1) and (2) misses both channels.

Fixed shape (sketch):

```ts
let replayDone = false
const buffer: StepEnvelope[] = []
const unsubscribe = deps.bus.subscribe(channel, (m) => {
  if (!replayDone) buffer.push(m)
  else reply.raw.write(encodeSse(m))
})

const detail = await app.withTenantTx(orgId, (trx) =>
  deps.storage.getSession(trx, { orgId, sessionId }),
)
const seenSpanIds = new Set<string>()
for (const step of detail?.steps ?? []) {
  reply.raw.write(encodeSse(stepToEnvelope(step)))
  seenSpanIds.add(step.spanId)
}
for (const m of buffer) {
  if (!seenSpanIds.has(m.spanId)) {
    reply.raw.write(encodeSse(m))
    seenSpanIds.add(m.spanId)
  }
}
replayDone = true

// onClose: unsubscribe()
```

Dedup via `spanId` is safe: the bus envelope carries the same `spanId` the DB stored under, and `writeTrace` is keyed on `(session_id, span_id)` so collisions are impossible across the boundary.

**Test** in `apps/server/test/pusher/race.test.ts` (new): use a controllable `bus` mock; emit a step on the channel during the `getSession()` Promise's microtask; assert the client receives the step exactly once.

### 3.2 JWT session revocation

**Migration `0005_password_version.ts`**:

```sql
ALTER TABLE users ADD COLUMN password_version int NOT NULL DEFAULT 1;
GRANT UPDATE ON users TO argus_app;  -- existing GRANT already covers it; harmless
```

**Schema** (`db/schema.ts`): `Users.password_version: number`. Add a default for write — Kysely handles `Generated<number>` or just `number` since DEFAULT 1 is at DB level. Use `password_version: Generated<number>` for inserts to elide the column.

**JWT** (`auth/jwt.ts`):

- `signJwt(payload: { userId: string, passwordVersion: number }, secret, ttl)`: payload field `pv`.
- `verifyJwt(token, secret)`: returns the typed payload including `pv`.

**Middleware** (`auth/middleware.ts`):

- After verifying signature + decoding, look up user; if `jwt.pv !== user.passwordVersion`, return 401 unauthenticated (same path as expired cookie).
- `UserRecord` gains `passwordVersion: number`.

**routes.ts**:

- `/auth/login` signs JWT with `record.passwordVersion`.
- `/auth/register` returns a user with `password_version = 1` (DB default); JWT signed with `1`.
- `/auth/password-reset/confirm` tx adds `password_version = password_version + 1` to the existing `UPDATE users SET password_hash = $1` (one UPDATE statement). The user is then forced to log in again — acceptable: that's why we sent a "password changed" courtesy email.

**Test**: new `test/auth/session-revocation.test.ts`:

1. Register → grab cookie A.
2. POST password-reset/request → POST confirm.
3. Use cookie A on `/auth/me` → expect 401.
4. Login with new password → cookie B.
5. Use cookie B on `/auth/me` → expect 200, user.id matches.

### 3.3 auth_one_time_tokens cleanup

**File**: `apps/server/src/modules/auth-tokens/cleanup.ts` (new).

```ts
import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import type { DB } from '../../db/schema.js'

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

**Wiring** in `main.ts`:

```ts
if (env.TOKEN_CLEANUP_INTERVAL_MS > 0) {
  const interval = setInterval(() => {
    cleanupExpiredTokens(db).catch((err) =>
      app.log.warn({ err, event: 'token_cleanup_failed' }, 'token cleanup failed'),
    )
  }, env.TOKEN_CLEANUP_INTERVAL_MS)
  interval.unref() // don't keep the event loop alive for the timer
}
```

Env var `TOKEN_CLEANUP_INTERVAL_MS` (default 3600000 = 1h, 0 = disabled). The `db` here is the `argus_app` pool — DELETE on `auth_one_time_tokens` only needs CRUD (table is not under RLS).

**Test**: `test/auth-tokens/cleanup.test.ts` — 3 cases:

1. Inserts consumed >30d and unconsumed-expired >1d rows → cleanup deletes both → returns count 2.
2. Inserts fresh tokens → cleanup deletes 0.
3. Inserts a token expired 12h ago (still in 1-day grace) → cleanup spares it.

### 3.4 audit_log retention

**File**: `apps/server/src/modules/audit/cleanup.ts` (new).

```ts
import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import type { DB } from '../../db/schema.js'

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

`audit_log` IS under RLS, but `tenant_isolation` covers SELECT/INSERT/UPDATE — the DELETE policy is implicit (no `WITH CHECK` on DELETE; PG's RLS evaluates `USING` for DELETE). With `argus_app` connection, deletion of cross-tenant rows is blocked because the USING clause requires the GUC matches. A naive `argus_app` cron deletes 0 rows (no GUC set).

Two ways to fix:

- (A) Run cleanup on the super-user `DATABASE_URL` pool (bypasses RLS entirely).
- (B) Run with `SET LOCAL row_security = off` inside a tx (requires the role to have privilege).

Use **(A)**. Add a second Kysely instance in `createServer` opts: `cleanupDb: Kysely<DB>` constructed from `databaseUrl` (super user) in `main.ts`. `ServerOptions` gains an optional `cleanupDb` field; for tests it can be the same as the admin db.

**Wiring** in `main.ts`:

```ts
const cleanupDb = createKysely(env.DATABASE_URL) // super user
// pass to createServer; spawned cron uses cleanupDb
```

In `createServer`, the cleanup intervals are started after `app.listen`:

```ts
if (opts.cleanupDb && env.AUDIT_RETENTION_DAYS > 0) {
  const interval = setInterval(() => {
    cleanupOldAuditLogs(opts.cleanupDb, env.AUDIT_RETENTION_DAYS).catch(...)
  }, env.AUDIT_CLEANUP_INTERVAL_MS)
  interval.unref()
}
```

Actually simpler: pass the cleanup interval handles back to `main.ts` for graceful shutdown. Implementation detail in the plan.

Env vars: `AUDIT_RETENTION_DAYS` (default 90, 0 = disabled), `AUDIT_CLEANUP_INTERVAL_MS` (default 3600000).

**Test**: `test/audit/cleanup.test.ts` — 2 cases:

1. Seed 5 rows: 3 at timestamp `now() - 100 days`, 2 at `now() - 30 days`. Call with `retentionDays = 90`. Assert 3 deleted, 2 remain.
2. Call with `retentionDays = 0`. Assert 0 deleted, 5 remain.

The test uses super-user `admin` to seed and assert.

### 3.5 Locale key parity vitest

**File**: `apps/web/src/i18n/locale-parity.test.ts` (new).

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
  test('zh-CN matches en key set', () => {
    expect(new Set(flatten(zhCN))).toEqual(new Set(flatten(en)))
  })
  test('ja matches en key set', () => {
    expect(new Set(flatten(ja))).toEqual(new Set(flatten(en)))
  })
})
```

Vitest already picks up `*.test.ts` files via the existing web test config. No CI config change.

### 3.6 Intl wrapper

**File**: `apps/web/src/lib/use-locale-format.ts` (new).

```ts
import { useTranslation } from 'react-i18next'
import { useMemo } from 'react'

export function useLocaleFormat() {
  const { i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? 'en'
  const dateTime = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }),
    [locale],
  )
  const number = useMemo(() => new Intl.NumberFormat(locale), [locale])
  return {
    dateTime: (d: Date) => dateTime.format(d),
    number: (n: number) => number.format(n),
  }
}
```

**Call sites to update** (4):

- `apps/web/src/routes/sessions/index.tsx` — `new Date(s.startedAt).toLocaleString()` → `f.dateTime(new Date(s.startedAt))`.
- `apps/web/src/features/session-replay/topbar/SessionTopbar.tsx` — duration uses `formatDuration` (helper, not toLocaleString — no change). Check if it has any toLocaleString.
- `apps/web/src/routes/settings/tokens.tsx` — `new Date(tok.createdAt).toLocaleString()` → wrapper.
- `apps/web/src/features/session-replay/lib/step-helpers.ts` — any time formatter; verify.

**Test**: `apps/web/src/lib/use-locale-format.test.ts` — render a component using the hook; switch i18n language; assert different formatted output for a known date.

### 3.7 Session-detail responsive layout

**File**: `apps/web/src/features/session-replay/index.tsx`.

Current:

```tsx
<div className="flex-1 grid grid-cols-[380px_1fr] overflow-hidden">
  <aside className="border-r border-hairline overflow-hidden">
    <RoundTimeline ... />
  </aside>
  <main className="overflow-hidden">...</main>
</div>
```

New:

```tsx
<div className="flex-1 grid grid-cols-1 grid-rows-[1fr_1fr] sm:grid-rows-1 sm:grid-cols-[minmax(280px,360px)_1fr] overflow-hidden">
  <aside className="border-b sm:border-b-0 sm:border-r border-hairline overflow-hidden">
    <RoundTimeline ... />
  </aside>
  <main className="overflow-hidden">...</main>
</div>
```

Tailwind's `sm:` breakpoint = 640px. Below 640px, two rows of equal height with a bottom border on the timeline. At/above 640px, two columns (the timeline takes 280–360px depending on viewport).

Visual verification via Claude Preview at 320 / 480 / 640 / 1200 widths.

No new test (M6 set the precedent of "web layout changes verified by Claude Preview").

## 4. CLAUDE.md additions

In "Common pitfalls", add:

```
- **Background cleanup cron jobs use the super-user `cleanupDb` pool, not `argus_app`.** `audit_log` is under RLS; without `SET LOCAL argus.current_org_id` cron-style DELETEs land in `0 rows`. The super-user connection bypasses RLS and runs the DELETE globally.
```

In "Working rules", add:

```
- **Adding a recurring server-side maintenance task:** put it in `apps/server/src/modules/<module>/cleanup.ts` as a pure async function over a `Kysely<DB>` (no Fastify decorator). Wire in `main.ts` via `setInterval(...).unref()` gated on an env-var interval (0 = disabled). Cron-style tasks DO NOT register Fastify routes.
```

## 5. Tests + counts after M9

New tests (count):

- `test/pusher/race.test.ts`: 1
- `test/auth/session-revocation.test.ts`: 3
- `test/auth-tokens/cleanup.test.ts`: 3
- `test/audit/cleanup.test.ts`: 2
- `apps/web/src/i18n/locale-parity.test.ts`: 2
- `apps/web/src/lib/use-locale-format.test.ts`: 2

Total: 13 new. Server ≥ 126 + 9 = 135. Web 14 + 4 = 18.

## 6. Migration ordering

Migration 0005: only `ALTER TABLE users ADD COLUMN password_version int NOT NULL DEFAULT 1` and the (redundant) GRANT. Simplest single-step migration. No data backfill needed (DEFAULT 1 handles existing rows).

## 7. Risks / known limits carried out of M9

- **Cleanup runs on a separate pool**: `cleanupDb` uses the super-user `DATABASE_URL`. If somehow this URL is misconfigured, the cleanup silently fails (warn-log). Acceptable for M9; productionizing the operator would set up monitoring.
- **`setInterval` cron is in-process**: if the server crashes, no cleanup until restart. Acceptable for now; future ops would replace with `pg_cron` or an external job runner.
- **Session revocation on password reset forces logout of THE user**: they must re-login with the new password immediately. UX-wise: the "password changed" courtesy email already mentions this; the web app's existing 401-handler redirects to `/login`.
- **Locale parity test only checks keys, not values**: an empty-string translation in zh-CN would still pass. Out of scope; future improvement could add value-emptyness.

## 8. Backlog after M9

- M10 multi-org + multi-member.
- M11 email body i18n.
- Audit log UI viewer + retention configurability.
- Server-side error message i18n.
- `login_failure` rows in `audit_log` (re-evaluate if compliance demands).
- Replace in-process cron with `pg_cron` or external job runner once data volumes warrant.

---
