# Argus M8 — Email Verification + Password Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship non-blocking email verification + a password-reset flow on top of M7's auth + RLS stack, both driven by Resend.

**Architecture:** New `email` module wraps the Resend SDK behind an `EmailSender` interface (with a `MockEmailSender` for tests). New `auth-tokens` module owns a polymorphic `auth_one_time_tokens` table (`kind = email_verify | password_reset`, 60s issue rate limit per `(user, kind)`, sha256-hashed). Four new server routes (`/auth/email-verify/{request,confirm}`, `/auth/password-reset/{request,confirm}`) plus three new web routes plus a `VerifyNagBar` shown when `emailVerifiedAt === null`. `/auth/register` fire-and-forgets a verification email; success does not depend on Resend reachability.

**Tech Stack additions:** `resend` ^4 (MIT). No new runtime deps on the web side.

**Spec:** [docs/superpowers/specs/2026-05-29-argus-m8-email-flows-design.md](../specs/2026-05-29-argus-m8-email-flows-design.md)

---

## File Structure (after this plan)

```
apps/server/src/
├── db/
│   ├── migrations/
│   │   └── 0004_email_verification_and_reset.ts   (NEW)
│   └── schema.ts                                  (MODIFIED: + AuthOneTimeTokens + Users.email_verified_at)
├── modules/
│   ├── email/                                     (NEW)
│   │   ├── index.ts
│   │   ├── types.ts                               (EmailSender, EmailMessage)
│   │   ├── resend-sender.ts                       (ResendEmailSender)
│   │   ├── mock-sender.ts                         (MockEmailSender)
│   │   ├── factory.ts                             (makeEmailSender)
│   │   └── templates.ts                           (3 inline EN templates)
│   ├── auth-tokens/                               (NEW)
│   │   ├── index.ts
│   │   ├── types.ts                               (TokenKind, TokenRecord)
│   │   ├── helpers.ts                             (generateRawToken, hashToken)
│   │   └── dao.ts                                 (issue, lookup, consume, revokeAllForUserKind)
│   └── auth/
│       ├── email-flows.ts                         (NEW: issueAndSendEmailVerify, issueAndSendPasswordReset)
│       ├── routes.ts                              (MODIFIED: + 4 routes, register hook, /me extension)
│       └── dao.ts                                 (MODIFIED: + markEmailVerified, updatePassword)
├── env.ts                                         (MODIFIED: + RESEND_API_KEY, EMAIL_FROM, APP_BASE_URL)
├── server.ts                                      (MODIFIED: emailSender opt + decorator)
└── main.ts                                        (MODIFIED: build email sender via factory)

apps/server/test/
├── email/                                         (NEW)
│   ├── mock-sender.test.ts
│   └── resend-sender.test.ts
├── auth-tokens/                                   (NEW)
│   └── dao.test.ts
├── auth/
│   ├── email-flows.test.ts                        (NEW)
│   ├── email-verify.test.ts                       (NEW)
│   ├── password-reset.test.ts                     (NEW)
│   └── routes.test.ts                             (MODIFIED: register asserts email sent)

apps/web/src/
├── routes/
│   ├── auth.verify-email.tsx                      (NEW)
│   ├── auth.forgot-password.tsx                   (NEW)
│   ├── auth.reset-password.tsx                    (NEW)
│   ├── __root.tsx                                 (MODIFIED: mount VerifyNagBar)
│   └── login.tsx                                  (MODIFIED: + Forgot password link)
├── features/email-verify-nag/                     (NEW)
│   └── VerifyNagBar.tsx
├── lib/
│   └── auth-provider.tsx                          (MODIFIED: User type adds emailVerifiedAt)
└── i18n/locales/
    ├── en.json                                    (MODIFIED: + auth.verifyEmail/forgotPassword/resetPassword + shell.verifyNag)
    ├── zh-CN.json                                 (MODIFIED)
    └── ja.json                                    (MODIFIED)

CLAUDE.md                                          (MODIFIED: + email module rule + new-token-kind rule)
```

---

## Common Conventions

- Commits: Conventional Commits, lowercase subject (commitlint).
- TypeScript strict; never `any` without `// reason:` comment.
- Tests: Vitest + testcontainers PG 16 (existing global setup at `apps/server/test/setup/global.ts`).
- Token storage convention: store sha256 of raw token in `token_hash`. Raw token format: `verify_<32 hex>` / `reset_<32 hex>`. Raw value lives only in the email link; DB has the hash.
- Email sender DI: tests inject `MockEmailSender` via `ServerOptions.emailSender` (new). Production wires `ResendEmailSender` via factory in `main.ts`.

---

## Task 1: Migration 0004 + schema.ts + `resend` dep

**Files:**

- Modify: `apps/server/package.json` (add `resend`)
- Create: `apps/server/src/db/migrations/0004_email_verification_and_reset.ts`
- Modify: `apps/server/src/db/schema.ts`

### Step 1: Install dep

Modify `apps/server/package.json` `dependencies` to add `"resend": "^4.0.0"` in alphabetical position. Then:

```bash
cd /Users/fooevr/Code/argus && pnpm install
```

### Step 2: Create `apps/server/src/db/migrations/0004_email_verification_and_reset.ts`

```ts
import { type Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  // 1. Add the verification timestamp to users.
  await sql`ALTER TABLE users ADD COLUMN email_verified_at timestamptz`.execute(db)

  // 2. Polymorphic one-time-token table (auth-tier; not under RLS).
  await db.schema
    .createTable('auth_one_time_tokens')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('user_id', 'uuid', (col) => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('kind', 'text', (col) => col.notNull())
    .addColumn('token_hash', 'text', (col) => col.notNull().unique())
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .addColumn('consumed_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  await sql`
    CREATE INDEX auth_tokens_user_kind_active_idx
      ON auth_one_time_tokens (user_id, kind, created_at DESC)
      WHERE consumed_at IS NULL
  `.execute(db)
  await sql`
    CREATE INDEX auth_tokens_hash_active_idx
      ON auth_one_time_tokens (token_hash)
      WHERE consumed_at IS NULL
  `.execute(db)

  // 3. Grant to the M7 runtime role.
  await sql`GRANT SELECT, INSERT, UPDATE ON auth_one_time_tokens TO argus_app`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`REVOKE ALL ON auth_one_time_tokens FROM argus_app`.execute(db)
  await db.schema.dropTable('auth_one_time_tokens').execute()
  await sql`ALTER TABLE users DROP COLUMN IF EXISTS email_verified_at`.execute(db)
}
```

### Step 3: Modify `apps/server/src/db/schema.ts`

Update the `Users` interface to add `email_verified_at`:

```ts
export interface Users {
  id: Generated<string>
  email: string
  password_hash: string
  email_verified_at: Timestamp | null
  created_at: Generated<Timestamp>
}
```

Add a new interface for the polymorphic token table:

```ts
export interface AuthOneTimeTokens {
  id: Generated<string>
  user_id: string
  kind: string
  token_hash: string
  expires_at: Timestamp
  consumed_at: Timestamp | null
  created_at: Generated<Timestamp>
}
```

Add to the `DB` interface:

```ts
export interface DB {
  // … existing …
  auth_one_time_tokens: AuthOneTimeTokens
}
```

### Step 4: Sanity test the migration

```bash
pnpm db:up
sleep 5
pnpm --filter @argus/server test test/db-tenant/migration-roles.test.ts 2>&1 | tail -10
pnpm db:down
```

Expected: 4 migration-roles tests still pass (they don't assert on the new table; just on M7 invariants).

### Step 5: Commit

```bash
git add apps/server/package.json pnpm-lock.yaml \
        apps/server/src/db/migrations/0004_email_verification_and_reset.ts \
        apps/server/src/db/schema.ts
git commit -m "feat(server): m8 migration 0004 — email_verified_at + auth_one_time_tokens"
```

---

## Task 2: `auth-tokens` module — types + helpers + DAO + unit tests

**Files:**

- Create: `apps/server/src/modules/auth-tokens/types.ts`
- Create: `apps/server/src/modules/auth-tokens/helpers.ts`
- Create: `apps/server/src/modules/auth-tokens/dao.ts`
- Create: `apps/server/src/modules/auth-tokens/index.ts`
- Create: `apps/server/test/auth-tokens/dao.test.ts`

### Step 1: Create `apps/server/src/modules/auth-tokens/types.ts`

```ts
export type TokenKind = 'email_verify' | 'password_reset'

export interface TokenRecord {
  id: string
  userId: string
  kind: TokenKind
  expiresAt: Date
  consumedAt: Date | null
  createdAt: Date
}
```

### Step 2: Create `apps/server/src/modules/auth-tokens/helpers.ts`

```ts
import { createHash, randomBytes } from 'node:crypto'
import type { TokenKind } from './types.js'

const PREFIX: Record<TokenKind, string> = {
  email_verify: 'verify',
  password_reset: 'reset',
}

export function generateRawToken(kind: TokenKind): string {
  return `${PREFIX[kind]}_${randomBytes(32).toString('hex')}`
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}
```

### Step 3: Create `apps/server/src/modules/auth-tokens/dao.ts`

```ts
import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import type { DB } from '../../db/schema.js'
import { hashToken } from './helpers.js'
import type { TokenKind, TokenRecord } from './types.js'

export const TOKEN_TTL_SECONDS: Record<TokenKind, number> = {
  email_verify: 24 * 3600,
  password_reset: 60 * 60,
}

export const ISSUE_RATE_LIMIT_SECONDS = 60

/** Returns null if the most-recent active token was issued within ISSUE_RATE_LIMIT_SECONDS. */
export async function findRateLimitBlockingToken(
  db: Kysely<DB>,
  userId: string,
  kind: TokenKind,
): Promise<TokenRecord | null> {
  const row = await db
    .selectFrom('auth_one_time_tokens')
    .where('user_id', '=', userId)
    .where('kind', '=', kind)
    .where('consumed_at', 'is', null)
    .where(
      'created_at',
      '>',
      sql<Date>`now() - interval '${sql.raw(String(ISSUE_RATE_LIMIT_SECONDS))} seconds'`,
    )
    .orderBy('created_at', 'desc')
    .selectAll()
    .executeTakeFirst()
  return row ? mapRow(row) : null
}

/** Mark all unconsumed tokens of this kind for this user as consumed. Returns the count. */
export async function revokeAllForUserKind(
  db: Kysely<DB>,
  userId: string,
  kind: TokenKind,
): Promise<number> {
  const result = await db
    .updateTable('auth_one_time_tokens')
    .set({ consumed_at: new Date() })
    .where('user_id', '=', userId)
    .where('kind', '=', kind)
    .where('consumed_at', 'is', null)
    .executeTakeFirst()
  return Number(result.numUpdatedRows ?? 0)
}

/** Insert a token row. Caller has already revoked stale ones. Returns the inserted record. */
export async function issueToken(
  db: Kysely<DB>,
  args: { userId: string; kind: TokenKind; rawToken: string },
): Promise<TokenRecord> {
  const expires = new Date(Date.now() + TOKEN_TTL_SECONDS[args.kind] * 1000)
  const inserted = await db
    .insertInto('auth_one_time_tokens')
    .values({
      user_id: args.userId,
      kind: args.kind,
      token_hash: hashToken(args.rawToken),
      expires_at: expires,
    })
    .returningAll()
    .executeTakeFirstOrThrow()
  return mapRow(inserted)
}

/** Look up an active token by raw value. Returns null if missing, expired, or consumed. */
export async function findActiveByRaw(
  db: Kysely<DB>,
  raw: string,
  kind: TokenKind,
): Promise<TokenRecord | null> {
  const row = await db
    .selectFrom('auth_one_time_tokens')
    .where('token_hash', '=', hashToken(raw))
    .where('kind', '=', kind)
    .where('consumed_at', 'is', null)
    .where('expires_at', '>', sql<Date>`now()`)
    .selectAll()
    .executeTakeFirst()
  return row ? mapRow(row) : null
}

/** Mark one token consumed by id. */
export async function consumeToken(db: Kysely<DB>, id: string): Promise<void> {
  await db
    .updateTable('auth_one_time_tokens')
    .set({ consumed_at: new Date() })
    .where('id', '=', id)
    .execute()
}

interface Row {
  id: string
  user_id: string
  kind: string
  expires_at: Date | string
  consumed_at: Date | string | null
  created_at: Date | string
}

function mapRow(r: Row): TokenRecord {
  return {
    id: r.id,
    userId: r.user_id,
    kind: r.kind as TokenKind,
    expiresAt: new Date(r.expires_at as unknown as string),
    consumedAt: r.consumed_at ? new Date(r.consumed_at as unknown as string) : null,
    createdAt: new Date(r.created_at as unknown as string),
  }
}
```

### Step 4: Create `apps/server/src/modules/auth-tokens/index.ts`

```ts
export * from './dao.js'
export * from './helpers.js'
export * from './types.js'
```

### Step 5: Create `apps/server/test/auth-tokens/dao.test.ts`

```ts
import { describe, expect, test, beforeAll, afterAll, beforeEach } from 'vitest'
import { sql } from 'kysely'
import {
  findActiveByRaw,
  findRateLimitBlockingToken,
  generateRawToken,
  hashToken,
  issueToken,
  consumeToken,
  revokeAllForUserKind,
} from '../../src/modules/auth-tokens/index.js'
import { createTestDb, truncateAll } from '../helpers/db.js'

const USER_A = '11111111-1111-1111-1111-111111111111' // seeded local user

describe('auth-tokens dao', () => {
  const db = createTestDb()
  beforeAll(async () => {
    // ensure local user + org exists (it is via migration 0002)
  })
  beforeEach(async () => {
    await truncateAll(db)
    await sql`INSERT INTO users (id, email, password_hash) VALUES (${USER_A}, 'a@test.com', '$x$') ON CONFLICT DO NOTHING`.execute(
      db,
    )
  })
  afterAll(async () => {
    await db.destroy()
  })

  test('generateRawToken + hashToken — deterministic hash, prefixed raw', () => {
    const raw = generateRawToken('email_verify')
    expect(raw.startsWith('verify_')).toBe(true)
    expect(raw.length).toBeGreaterThan(40)
    expect(hashToken(raw)).toBe(hashToken(raw))
    expect(hashToken(raw)).not.toBe(hashToken(generateRawToken('email_verify')))
  })

  test('issueToken + findActiveByRaw — happy path', async () => {
    const raw = generateRawToken('email_verify')
    const issued = await issueToken(db, { userId: USER_A, kind: 'email_verify', rawToken: raw })
    expect(issued.kind).toBe('email_verify')
    const found = await findActiveByRaw(db, raw, 'email_verify')
    expect(found?.id).toBe(issued.id)
  })

  test('findActiveByRaw — returns null for wrong kind', async () => {
    const raw = generateRawToken('email_verify')
    await issueToken(db, { userId: USER_A, kind: 'email_verify', rawToken: raw })
    const found = await findActiveByRaw(db, raw, 'password_reset')
    expect(found).toBeNull()
  })

  test('consumeToken — sets consumed_at, findActiveByRaw then returns null', async () => {
    const raw = generateRawToken('password_reset')
    const issued = await issueToken(db, { userId: USER_A, kind: 'password_reset', rawToken: raw })
    await consumeToken(db, issued.id)
    const found = await findActiveByRaw(db, raw, 'password_reset')
    expect(found).toBeNull()
  })

  test('expired token — returns null', async () => {
    const raw = generateRawToken('password_reset')
    const issued = await issueToken(db, { userId: USER_A, kind: 'password_reset', rawToken: raw })
    // Backdate expiry
    await sql`UPDATE auth_one_time_tokens SET expires_at = now() - interval '1 minute' WHERE id = ${issued.id}`.execute(
      db,
    )
    const found = await findActiveByRaw(db, raw, 'password_reset')
    expect(found).toBeNull()
  })

  test('revokeAllForUserKind — consumes only the specified kind for user', async () => {
    const a = generateRawToken('email_verify')
    const b = generateRawToken('email_verify')
    const c = generateRawToken('password_reset')
    await issueToken(db, { userId: USER_A, kind: 'email_verify', rawToken: a })
    await issueToken(db, { userId: USER_A, kind: 'email_verify', rawToken: b })
    await issueToken(db, { userId: USER_A, kind: 'password_reset', rawToken: c })
    const revoked = await revokeAllForUserKind(db, USER_A, 'email_verify')
    expect(revoked).toBe(2)
    expect(await findActiveByRaw(db, a, 'email_verify')).toBeNull()
    expect(await findActiveByRaw(db, b, 'email_verify')).toBeNull()
    expect(await findActiveByRaw(db, c, 'password_reset')).not.toBeNull()
  })

  test('findRateLimitBlockingToken — returns recent unconsumed token', async () => {
    const raw = generateRawToken('email_verify')
    const issued = await issueToken(db, { userId: USER_A, kind: 'email_verify', rawToken: raw })
    const blocker = await findRateLimitBlockingToken(db, USER_A, 'email_verify')
    expect(blocker?.id).toBe(issued.id)
  })

  test('findRateLimitBlockingToken — null if last token is >60s old', async () => {
    const raw = generateRawToken('email_verify')
    const issued = await issueToken(db, { userId: USER_A, kind: 'email_verify', rawToken: raw })
    await sql`UPDATE auth_one_time_tokens SET created_at = now() - interval '2 minutes' WHERE id = ${issued.id}`.execute(
      db,
    )
    const blocker = await findRateLimitBlockingToken(db, USER_A, 'email_verify')
    expect(blocker).toBeNull()
  })

  test('findRateLimitBlockingToken — null when no token issued', async () => {
    const blocker = await findRateLimitBlockingToken(db, USER_A, 'password_reset')
    expect(blocker).toBeNull()
  })
})
```

### Step 6: Run

```bash
pnpm db:up
sleep 5
pnpm --filter @argus/server test test/auth-tokens/dao.test.ts 2>&1 | tail -25
pnpm db:down
```

Expected: 9 tests pass.

### Step 7: Commit

```bash
git add apps/server/src/modules/auth-tokens apps/server/test/auth-tokens
git commit -m "feat(server): m8 auth-tokens module — polymorphic one-time tokens"
```

---

## Task 3: `email` module — types + Resend + Mock + factory + templates + tests

**Files:**

- Create: `apps/server/src/modules/email/types.ts`
- Create: `apps/server/src/modules/email/resend-sender.ts`
- Create: `apps/server/src/modules/email/mock-sender.ts`
- Create: `apps/server/src/modules/email/factory.ts`
- Create: `apps/server/src/modules/email/templates.ts`
- Create: `apps/server/src/modules/email/index.ts`
- Create: `apps/server/test/email/mock-sender.test.ts`
- Create: `apps/server/test/email/resend-sender.test.ts`

### Step 1: Create `apps/server/src/modules/email/types.ts`

```ts
export interface EmailMessage {
  to: string
  subject: string
  html: string
  text: string
}

export interface EmailSender {
  send(msg: EmailMessage): Promise<void>
}
```

### Step 2: Create `apps/server/src/modules/email/resend-sender.ts`

```ts
import { Resend } from 'resend'
import type { EmailMessage, EmailSender } from './types.js'

export class ResendEmailSender implements EmailSender {
  private client: Resend
  constructor(
    private apiKey: string,
    private from: string,
  ) {
    this.client = new Resend(apiKey)
  }
  async send(msg: EmailMessage): Promise<void> {
    const { error } = await this.client.emails.send({
      from: this.from,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    })
    if (error) {
      throw new Error(`resend_send_failed: ${error.message}`)
    }
  }
}
```

### Step 3: Create `apps/server/src/modules/email/mock-sender.ts`

```ts
import type { EmailMessage, EmailSender } from './types.js'

/**
 * Collects sent messages in memory; tests assert on `sender.sent`.
 * Optionally `throwOnSend` simulates Resend outage for register-resilience tests.
 */
export class MockEmailSender implements EmailSender {
  public sent: EmailMessage[] = []
  public throwOnSend = false
  async send(msg: EmailMessage): Promise<void> {
    if (this.throwOnSend) throw new Error('mock_resend_outage')
    this.sent.push(msg)
  }
}
```

### Step 4: Create `apps/server/src/modules/email/factory.ts`

```ts
import { ResendEmailSender } from './resend-sender.js'
import type { EmailSender } from './types.js'

export function makeEmailSender(opts: { resendApiKey?: string; from: string }): EmailSender {
  if (!opts.resendApiKey) {
    throw new Error('RESEND_API_KEY not configured')
  }
  return new ResendEmailSender(opts.resendApiKey, opts.from)
}
```

### Step 5: Create `apps/server/src/modules/email/templates.ts`

```ts
import type { EmailMessage } from './types.js'

const FOOTER_HTML = `<p style="color:#888;font-size:12px;margin-top:24px">If this wasn't you, please ignore this message.</p>`
const FOOTER_TEXT = `\n\nIf this wasn't you, please ignore this message.`

export function emailVerifyTemplate(verifyUrl: string): Omit<EmailMessage, 'to'> {
  return {
    subject: 'Verify your Argus account',
    html: `<div style="font-family:sans-serif;font-size:14px;line-height:1.5">
  <p>Welcome to Argus. Verify your email address to confirm your account:</p>
  <p><a href="${verifyUrl}" style="display:inline-block;padding:8px 16px;background:#0a84ff;color:white;text-decoration:none;border-radius:4px">Verify email</a></p>
  <p>Or paste this link into your browser:<br><code style="word-break:break-all">${verifyUrl}</code></p>
  ${FOOTER_HTML}
</div>`,
    text: `Welcome to Argus. Verify your email at: ${verifyUrl}${FOOTER_TEXT}`,
  }
}

export function passwordResetTemplate(resetUrl: string): Omit<EmailMessage, 'to'> {
  return {
    subject: 'Reset your Argus password',
    html: `<div style="font-family:sans-serif;font-size:14px;line-height:1.5">
  <p>We received a request to reset your Argus password. Click below to set a new one (the link expires in 1 hour):</p>
  <p><a href="${resetUrl}" style="display:inline-block;padding:8px 16px;background:#0a84ff;color:white;text-decoration:none;border-radius:4px">Reset password</a></p>
  <p>Or paste this link into your browser:<br><code style="word-break:break-all">${resetUrl}</code></p>
  ${FOOTER_HTML}
</div>`,
    text: `Reset your Argus password at (expires in 1 hour): ${resetUrl}${FOOTER_TEXT}`,
  }
}

export function passwordChangedTemplate(
  at: Date,
  ip: string | undefined,
): Omit<EmailMessage, 'to'> {
  const when = at.toISOString()
  const where = ip ? ` from IP ${ip}` : ''
  return {
    subject: 'Your Argus password was changed',
    html: `<div style="font-family:sans-serif;font-size:14px;line-height:1.5">
  <p>Your Argus password was changed on ${when}${where}.</p>
  <p>If this wasn't you, request a new reset link and contact your administrator.</p>
</div>`,
    text: `Your Argus password was changed on ${when}${where}. If this wasn't you, request a new reset link and contact your administrator.`,
  }
}
```

### Step 6: Create `apps/server/src/modules/email/index.ts`

```ts
export * from './types.js'
export * from './mock-sender.js'
export * from './resend-sender.js'
export * from './factory.js'
export * as templates from './templates.js'
```

### Step 7: Create `apps/server/test/email/mock-sender.test.ts`

```ts
import { describe, expect, test } from 'vitest'
import { MockEmailSender } from '../../src/modules/email/index.js'

describe('MockEmailSender', () => {
  test('collects sent messages', async () => {
    const sender = new MockEmailSender()
    await sender.send({ to: 'a@a.com', subject: 's', html: 'h', text: 't' })
    expect(sender.sent).toHaveLength(1)
    expect(sender.sent[0]!.to).toBe('a@a.com')
  })

  test('throws when throwOnSend is set', async () => {
    const sender = new MockEmailSender()
    sender.throwOnSend = true
    await expect(
      sender.send({ to: 'a@a.com', subject: 's', html: 'h', text: 't' }),
    ).rejects.toThrow('mock_resend_outage')
  })
})
```

### Step 8: Create `apps/server/test/email/resend-sender.test.ts`

```ts
import { describe, expect, test, vi, beforeEach } from 'vitest'

const send = vi.fn()
vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: { send },
  })),
}))

// Import AFTER mocking so the mock is wired.
const { ResendEmailSender } = await import('../../src/modules/email/resend-sender.js')

describe('ResendEmailSender', () => {
  beforeEach(() => {
    send.mockReset()
  })

  test('calls Resend.emails.send with mapped fields', async () => {
    send.mockResolvedValue({ data: { id: 'abc' }, error: null })
    const sender = new ResendEmailSender('rs_test_key', 'Argus <noreply@argus.dev>')
    await sender.send({
      to: 'user@example.com',
      subject: 'hi',
      html: '<p>hi</p>',
      text: 'hi',
    })
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith({
      from: 'Argus <noreply@argus.dev>',
      to: 'user@example.com',
      subject: 'hi',
      html: '<p>hi</p>',
      text: 'hi',
    })
  })

  test('throws when Resend returns an error', async () => {
    send.mockResolvedValue({
      data: null,
      error: { message: 'invalid_to', name: 'validation_error' },
    })
    const sender = new ResendEmailSender('rs_test_key', 'Argus <noreply@argus.dev>')
    await expect(sender.send({ to: 'broken', subject: 's', html: 'h', text: 't' })).rejects.toThrow(
      /resend_send_failed: invalid_to/,
    )
  })
})
```

### Step 9: Run

```bash
pnpm --filter @argus/server test test/email 2>&1 | tail -20
```

Expected: 4 tests pass (no DB needed).

### Step 10: Commit

```bash
git add apps/server/src/modules/email apps/server/test/email
git commit -m "feat(server): m8 email module — Resend sender + mock + templates"
```

---

## Task 4: `auth/email-flows.ts` helpers + tests

**Files:**

- Create: `apps/server/src/modules/auth/email-flows.ts`
- Create: `apps/server/test/auth/email-flows.test.ts`

### Step 1: Create `apps/server/src/modules/auth/email-flows.ts`

```ts
import type { Kysely } from 'kysely'
import type { DB } from '../../db/schema.js'
import { generateRawToken, issueToken, revokeAllForUserKind } from '../auth-tokens/index.js'
import type { EmailSender } from '../email/index.js'
import { templates } from '../email/index.js'

export interface EmailFlowsDeps {
  db: Kysely<DB>
  emailSender: EmailSender
  appBaseUrl: string
}

/** Revoke prior verify tokens, issue new, send verification email. */
export async function issueAndSendEmailVerify(
  deps: EmailFlowsDeps,
  args: { userId: string; email: string },
): Promise<void> {
  await revokeAllForUserKind(deps.db, args.userId, 'email_verify')
  const raw = generateRawToken('email_verify')
  await issueToken(deps.db, { userId: args.userId, kind: 'email_verify', rawToken: raw })
  const url = `${deps.appBaseUrl}/auth/verify-email?token=${encodeURIComponent(raw)}`
  const msg = templates.emailVerifyTemplate(url)
  await deps.emailSender.send({ to: args.email, ...msg })
}

/** Revoke prior reset tokens, issue new, send reset email. */
export async function issueAndSendPasswordReset(
  deps: EmailFlowsDeps,
  args: { userId: string; email: string },
): Promise<void> {
  await revokeAllForUserKind(deps.db, args.userId, 'password_reset')
  const raw = generateRawToken('password_reset')
  await issueToken(deps.db, { userId: args.userId, kind: 'password_reset', rawToken: raw })
  const url = `${deps.appBaseUrl}/auth/reset-password?token=${encodeURIComponent(raw)}`
  const msg = templates.passwordResetTemplate(url)
  await deps.emailSender.send({ to: args.email, ...msg })
}

/** Send the courtesy "password changed" notification (no link). */
export async function sendPasswordChanged(
  deps: Pick<EmailFlowsDeps, 'emailSender'>,
  args: { email: string; at: Date; ip?: string },
): Promise<void> {
  const msg = templates.passwordChangedTemplate(args.at, args.ip)
  await deps.emailSender.send({ to: args.email, ...msg })
}
```

### Step 2: Create `apps/server/test/auth/email-flows.test.ts`

```ts
import { describe, expect, test, beforeAll, afterAll, beforeEach } from 'vitest'
import { sql } from 'kysely'
import {
  issueAndSendEmailVerify,
  issueAndSendPasswordReset,
  sendPasswordChanged,
} from '../../src/modules/auth/email-flows.js'
import { MockEmailSender } from '../../src/modules/email/index.js'
import { findActiveByRaw } from '../../src/modules/auth-tokens/index.js'
import { createTestDb, truncateAll } from '../helpers/db.js'

const USER_A = '22222222-2222-2222-2222-222222222222'
const EMAIL_A = 'flowuser@test.com'

describe('auth/email-flows', () => {
  const db = createTestDb()
  let sender: MockEmailSender
  beforeAll(async () => {
    await sql`INSERT INTO orgs (id, name) VALUES ('33333333-3333-3333-3333-333333333333', 'flow-org') ON CONFLICT DO NOTHING`.execute(
      db,
    )
  })
  beforeEach(async () => {
    await truncateAll(db)
    await sql`INSERT INTO orgs (id, name) VALUES ('33333333-3333-3333-3333-333333333333', 'flow-org') ON CONFLICT DO NOTHING`.execute(
      db,
    )
    await sql`INSERT INTO users (id, email, password_hash) VALUES (${USER_A}, ${EMAIL_A}, '$x$') ON CONFLICT DO NOTHING`.execute(
      db,
    )
    sender = new MockEmailSender()
  })
  afterAll(async () => {
    await db.destroy()
  })

  test('issueAndSendEmailVerify — inserts token + sends one email with verify URL', async () => {
    await issueAndSendEmailVerify(
      { db, emailSender: sender, appBaseUrl: 'http://localhost:5173' },
      { userId: USER_A, email: EMAIL_A },
    )
    expect(sender.sent).toHaveLength(1)
    expect(sender.sent[0]!.to).toBe(EMAIL_A)
    const link = sender.sent[0]!.text.match(/http[^\s]+/)?.[0]
    expect(link).toBeDefined()
    const raw = new URL(link!).searchParams.get('token')!
    expect(raw.startsWith('verify_')).toBe(true)
    const found = await findActiveByRaw(db, raw, 'email_verify')
    expect(found?.userId).toBe(USER_A)
  })

  test('issueAndSendEmailVerify — second call revokes the first token', async () => {
    await issueAndSendEmailVerify(
      { db, emailSender: sender, appBaseUrl: 'http://localhost:5173' },
      { userId: USER_A, email: EMAIL_A },
    )
    const firstRaw = new URL(sender.sent[0]!.text.match(/http[^\s]+/)![0]).searchParams.get(
      'token',
    )!
    await issueAndSendEmailVerify(
      { db, emailSender: sender, appBaseUrl: 'http://localhost:5173' },
      { userId: USER_A, email: EMAIL_A },
    )
    expect(await findActiveByRaw(db, firstRaw, 'email_verify')).toBeNull()
    expect(sender.sent).toHaveLength(2)
  })

  test('issueAndSendPasswordReset — link goes to reset-password page with reset_ prefix', async () => {
    await issueAndSendPasswordReset(
      { db, emailSender: sender, appBaseUrl: 'http://localhost:5173' },
      { userId: USER_A, email: EMAIL_A },
    )
    expect(sender.sent).toHaveLength(1)
    const url = new URL(sender.sent[0]!.text.match(/http[^\s]+/)![0])
    expect(url.pathname).toBe('/auth/reset-password')
    expect(url.searchParams.get('token')!.startsWith('reset_')).toBe(true)
  })

  test('sendPasswordChanged — no link, mentions IP if given', async () => {
    await sendPasswordChanged(
      { emailSender: sender },
      { email: EMAIL_A, at: new Date(0), ip: '10.0.0.1' },
    )
    expect(sender.sent).toHaveLength(1)
    expect(sender.sent[0]!.text).not.toMatch(/http/)
    expect(sender.sent[0]!.text).toContain('10.0.0.1')
  })
})
```

### Step 3: Run

```bash
pnpm db:up
sleep 5
pnpm --filter @argus/server test test/auth/email-flows.test.ts 2>&1 | tail -20
pnpm db:down
```

Expected: 4 tests pass.

### Step 4: Commit

```bash
git add apps/server/src/modules/auth/email-flows.ts apps/server/test/auth/email-flows.test.ts
git commit -m "feat(server): m8 auth/email-flows — issue+send helpers + tests"
```

---

## Task 5: env + server.ts wiring (emailSender opt + decorator) + main.ts factory

**Files:**

- Modify: `apps/server/src/env.ts`
- Modify: `apps/server/src/server.ts`
- Modify: `apps/server/src/main.ts`

### Step 1: Modify `apps/server/src/env.ts`

Add to the schema:

```ts
const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().url(),
  APP_DATABASE_URL: z.string().url().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  ARGUS_MODE: z.enum(['local', 'multi-tenant']).default('local'),
  JWT_SECRET: z.string().min(32).default('local-dev-secret-not-for-production-x'),
  COOKIE_NAME: z.string().default('argus_session'),
  GRPC_PORT: z.coerce.number().int().min(0).default(4317),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('Argus <noreply@argus.dev>'),
  APP_BASE_URL: z.string().url().default('http://localhost:5173'),
})
```

(`loadEnv` body unchanged — APP_DATABASE_URL defaulting logic stays.)

### Step 2: Modify `apps/server/src/server.ts`

Add `emailSender?: EmailSender` and `appBaseUrl: string` to `ServerOptions`. If not passed, build via `makeEmailSender`. Register a Fastify decorator `app.emailSender` for routes.

Full updated `ServerOptions` interface:

```ts
export interface ServerOptions {
  databaseUrl: string
  appDatabaseUrl: string
  logLevel?: string
  mode: 'local' | 'multi-tenant'
  jwtSecret: string
  cookieName: string
  cookieSecure?: boolean
  sessionTtlSeconds?: number
  resendApiKey?: string
  emailFrom?: string
  appBaseUrl: string
  /** Inject for tests; production builds from resendApiKey + emailFrom. */
  emailSender?: EmailSender
}
```

In `createServer`:

```ts
import type { EmailSender } from './modules/email/index.js'
import { MockEmailSender, makeEmailSender } from './modules/email/index.js'

// after the db + dbTenantPlugin registration, before authRoutes:
let emailSender: EmailSender
if (opts.emailSender) {
  emailSender = opts.emailSender
} else if (opts.resendApiKey) {
  emailSender = makeEmailSender({
    resendApiKey: opts.resendApiKey,
    from: opts.emailFrom ?? 'Argus <noreply@argus.dev>',
  })
} else {
  // Local mode without Resend: install a no-op-but-throwing sender so tests
  // that DO exercise sending fail loudly, but boot succeeds.
  emailSender = new MockEmailSender()
  ;(emailSender as MockEmailSender).throwOnSend = true
}
app.decorate('emailSender', emailSender)
```

Also extend the module augmentation for FastifyInstance:

```ts
declare module 'fastify' {
  interface FastifyInstance {
    emailSender: EmailSender
  }
}
```

(Put the augmentation in a NEW file `apps/server/src/modules/email/decorate.ts` and import it in `server.ts` so the augmentation registers.)

### Step 3: Create `apps/server/src/modules/email/decorate.ts`

```ts
import type { EmailSender } from './types.js'

declare module 'fastify' {
  interface FastifyInstance {
    emailSender: EmailSender
  }
}
```

### Step 4: Update `apps/server/src/modules/email/index.ts`

Add the re-export:

```ts
export * from './types.js'
export * from './mock-sender.js'
export * from './resend-sender.js'
export * from './factory.js'
export * as templates from './templates.js'
import './decorate.js'
```

### Step 5: Modify `apps/server/src/main.ts`

Pass the new env-derived fields:

```ts
const { app, db, bus } = await createServer({
  databaseUrl: env.DATABASE_URL,
  appDatabaseUrl: env.APP_DATABASE_URL!,
  logLevel: env.LOG_LEVEL,
  mode: env.ARGUS_MODE,
  jwtSecret: env.JWT_SECRET,
  cookieName: env.COOKIE_NAME,
  resendApiKey: env.RESEND_API_KEY,
  emailFrom: env.EMAIL_FROM,
  appBaseUrl: env.APP_BASE_URL,
})
```

### Step 6: Modify `apps/server/test/healthz.test.ts`

Add the three new required fields to the test's ServerOptions object. `appBaseUrl: 'http://localhost:5173'` is enough.

### Step 7: typecheck + run healthz test

```bash
pnpm --filter @argus/server typecheck 2>&1 | tail -20
pnpm db:up
sleep 5
pnpm --filter @argus/server test test/healthz.test.ts 2>&1 | tail -10
pnpm db:down
```

Expected: typecheck clean; healthz test passes.

### Step 8: Commit

```bash
git add apps/server/src/env.ts apps/server/src/server.ts apps/server/src/main.ts \
        apps/server/src/modules/email/decorate.ts apps/server/src/modules/email/index.ts \
        apps/server/test/healthz.test.ts
git commit -m "feat(server): m8 server wiring — env + app.emailSender decorator"
```

---

## Task 6: `/auth/email-verify/{request,confirm}` routes + tests

**Files:**

- Modify: `apps/server/src/modules/auth/routes.ts`
- Modify: `apps/server/src/modules/auth/dao.ts`
- Create: `apps/server/test/auth/email-verify.test.ts`

### Step 1: Add `markEmailVerified` to `apps/server/src/modules/auth/dao.ts`

Append to the existing file:

```ts
export async function markEmailVerified(db: Kysely<DB>, userId: string): Promise<void> {
  await db
    .updateTable('users')
    .set({ email_verified_at: new Date() })
    .where('id', '=', userId)
    .execute()
}
```

### Step 2: Modify `apps/server/src/modules/auth/routes.ts`

Update `AuthRoutesDeps`:

```ts
import type { EmailSender } from '../email/index.js'

export interface AuthRoutesDeps {
  db: Kysely<DB>
  cookieName: string
  jwtSecret: string
  cookieSecure: boolean
  sessionTtlSeconds: number
  authMiddleware: preHandlerHookHandler
  emailSender: EmailSender
  appBaseUrl: string
}
```

Update `server.ts`'s `app.register(authRoutes, { ... })` to also pass `emailSender: app.emailSender, appBaseUrl: opts.appBaseUrl`.

In `routes.ts` add imports:

```ts
import { issueAndSendEmailVerify } from './email-flows.js'
import { findActiveByRaw, findRateLimitBlockingToken, consumeToken } from '../auth-tokens/index.js'
import { markEmailVerified } from './dao.js'
```

Add the two routes (after `/auth/me`):

```ts
app.post(
  '/auth/email-verify/request',
  { preHandler: deps.authMiddleware },
  async (request, reply) => {
    if (!request.auth) {
      reply.code(401)
      return { error: 'unauthenticated' }
    }
    const userId = request.auth.user.id
    const email = request.auth.user.email
    const blocker = await findRateLimitBlockingToken(deps.db, userId, 'email_verify')
    if (blocker) {
      return { ok: true } // silent rate limit
    }
    try {
      await issueAndSendEmailVerify(
        { db: deps.db, emailSender: deps.emailSender, appBaseUrl: deps.appBaseUrl },
        { userId, email },
      )
    } catch (err) {
      request.log.warn(
        { err, event: 'email_send_failed', purpose: 'email_verify_request' },
        'email send failed',
      )
    }
    return { ok: true }
  },
)

const confirmBodySchema = z.object({ token: z.string().min(8) })

app.post('/auth/email-verify/confirm', async (request, reply) => {
  const parsed = confirmBodySchema.safeParse(request.body)
  if (!parsed.success) {
    reply.code(400)
    return { error: 'invalid_input' }
  }
  const token = await findActiveByRaw(deps.db, parsed.data.token, 'email_verify')
  if (!token) {
    reply.code(400)
    return { error: 'invalid_or_expired_token' }
  }
  await deps.db.transaction().execute(async (trx) => {
    await trx
      .updateTable('users')
      .set({ email_verified_at: new Date() })
      .where('id', '=', token.userId)
      .execute()
    await trx
      .updateTable('auth_one_time_tokens')
      .set({ consumed_at: new Date() })
      .where('id', '=', token.id)
      .execute()
  })
  return { ok: true }
})
```

### Step 3: Create `apps/server/test/auth/email-verify.test.ts`

The test builds a Fastify app with the new routes + Mock sender + dbTenantPlugin. Pattern mirrors M7-9's `routes.test.ts`.

```ts
import { describe, expect, test, beforeAll, afterAll, beforeEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import { sql } from 'kysely'
import {
  authRoutes,
  resolveAuthContext,
  type AuthMiddlewareDeps,
} from '../../src/modules/auth/index.js'
import { dbTenantPlugin } from '../../src/modules/db-tenant/index.js'
import { MockEmailSender } from '../../src/modules/email/index.js'
import { createTestDb, createAppRoleTestDb, truncateAll } from '../helpers/db.js'

const JWT_SECRET = 'test-secret-at-least-32-chars-long-x'

describe('email verify routes', () => {
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
    sender.throwOnSend = false
  })
  afterAll(async () => {
    await app.close()
    await appDb.destroy()
    await admin.destroy()
  })

  async function registerAndCookie(email: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password: 'password123' },
    })
    expect(res.statusCode).toBe(200)
    const c = res.cookies[0]!
    return `${c.name}=${c.value}`
  }

  test('POST /auth/email-verify/request — emits one email', async () => {
    const cookie = await registerAndCookie('v1@test.com')
    sender.sent.length = 0
    const res = await app.inject({
      method: 'POST',
      url: '/auth/email-verify/request',
      headers: { cookie },
    })
    expect(res.statusCode).toBe(200)
    expect(sender.sent).toHaveLength(1)
    expect(sender.sent[0]!.to).toBe('v1@test.com')
  })

  test('POST /auth/email-verify/request — second call within 60s returns 200 but no email', async () => {
    const cookie = await registerAndCookie('v2@test.com')
    sender.sent.length = 0
    await app.inject({ method: 'POST', url: '/auth/email-verify/request', headers: { cookie } })
    await app.inject({ method: 'POST', url: '/auth/email-verify/request', headers: { cookie } })
    expect(sender.sent).toHaveLength(1)
  })

  test('POST /auth/email-verify/request — 401 when unauthenticated', async () => {
    const res = await app.inject({ method: 'POST', url: '/auth/email-verify/request' })
    expect(res.statusCode).toBe(401)
  })

  test('POST /auth/email-verify/confirm — valid token marks user verified', async () => {
    const cookie = await registerAndCookie('v3@test.com')
    sender.sent.length = 0
    await app.inject({ method: 'POST', url: '/auth/email-verify/request', headers: { cookie } })
    const url = sender.sent[0]!.text.match(/http[^\s]+/)![0]
    const token = new URL(url).searchParams.get('token')!
    const res = await app.inject({
      method: 'POST',
      url: '/auth/email-verify/confirm',
      payload: { token },
    })
    expect(res.statusCode).toBe(200)
    const u = await admin
      .selectFrom('users')
      .where('email', '=', 'v3@test.com')
      .select(['email_verified_at'])
      .executeTakeFirst()
    expect(u?.email_verified_at).not.toBeNull()
  })

  test('POST /auth/email-verify/confirm — invalid token returns 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/email-verify/confirm',
      payload: { token: 'verify_garbage' },
    })
    expect(res.statusCode).toBe(400)
  })

  test('POST /auth/email-verify/confirm — same token used twice returns 400 on second', async () => {
    const cookie = await registerAndCookie('v4@test.com')
    sender.sent.length = 0
    await app.inject({ method: 'POST', url: '/auth/email-verify/request', headers: { cookie } })
    const token = new URL(sender.sent[0]!.text.match(/http[^\s]+/)![0]).searchParams.get('token')!
    const first = await app.inject({
      method: 'POST',
      url: '/auth/email-verify/confirm',
      payload: { token },
    })
    expect(first.statusCode).toBe(200)
    const second = await app.inject({
      method: 'POST',
      url: '/auth/email-verify/confirm',
      payload: { token },
    })
    expect(second.statusCode).toBe(400)
  })
})
```

### Step 4: Run

```bash
pnpm db:up
sleep 5
pnpm --filter @argus/server test test/auth/email-verify.test.ts 2>&1 | tail -25
pnpm db:down
```

Expected: 6 tests pass.

### Step 5: Commit

```bash
git add apps/server/src/modules/auth/routes.ts apps/server/src/modules/auth/dao.ts \
        apps/server/test/auth/email-verify.test.ts
git commit -m "feat(server): m8 /auth/email-verify routes — request + confirm"
```

---

## Task 7: `/auth/password-reset/{request,confirm}` routes + tests

**Files:**

- Modify: `apps/server/src/modules/auth/routes.ts`
- Modify: `apps/server/src/modules/auth/dao.ts`
- Create: `apps/server/test/auth/password-reset.test.ts`

### Step 1: Add `updatePassword` to `apps/server/src/modules/auth/dao.ts`

Append:

```ts
export async function updatePassword(
  db: Kysely<DB>,
  userId: string,
  passwordHash: string,
): Promise<void> {
  await db
    .updateTable('users')
    .set({ password_hash: passwordHash })
    .where('id', '=', userId)
    .execute()
}
```

### Step 2: Add the two routes to `apps/server/src/modules/auth/routes.ts`

After the email-verify routes from T6:

```ts
import { issueAndSendPasswordReset, sendPasswordChanged } from './email-flows.js'
import { hashPassword } from './password.js'
import { revokeAllForUserKind } from '../auth-tokens/index.js'

const resetRequestBodySchema = z.object({ email: z.string().email() })
const resetConfirmBodySchema = z.object({
  token: z.string().min(8),
  newPassword: z.string().min(8),
})

app.post('/auth/password-reset/request', async (request, reply) => {
  const parsed = resetRequestBodySchema.safeParse(request.body)
  if (!parsed.success) {
    reply.code(400)
    return { error: 'invalid_input' }
  }
  const { email } = parsed.data
  const user = await findUserByEmail(deps.db, email)
  if (!user) {
    return { ok: true } // enumeration-safe
  }
  const blocker = await findRateLimitBlockingToken(deps.db, user.id, 'password_reset')
  if (blocker) {
    return { ok: true }
  }
  try {
    await issueAndSendPasswordReset(
      { db: deps.db, emailSender: deps.emailSender, appBaseUrl: deps.appBaseUrl },
      { userId: user.id, email },
    )
  } catch (err) {
    request.log.warn(
      { err, event: 'email_send_failed', purpose: 'password_reset_request' },
      'email send failed',
    )
  }
  return { ok: true }
})

app.post('/auth/password-reset/confirm', async (request, reply) => {
  const parsed = resetConfirmBodySchema.safeParse(request.body)
  if (!parsed.success) {
    reply.code(400)
    return { error: 'invalid_input', issues: parsed.error.issues }
  }
  const { token, newPassword } = parsed.data
  const found = await findActiveByRaw(deps.db, token, 'password_reset')
  if (!found) {
    reply.code(400)
    return { error: 'invalid_or_expired_token' }
  }
  const newHash = await hashPassword(newPassword)
  const userEmail = (
    await deps.db
      .selectFrom('users')
      .where('id', '=', found.userId)
      .select('email')
      .executeTakeFirstOrThrow()
  ).email
  await deps.db.transaction().execute(async (trx) => {
    await trx
      .updateTable('users')
      .set({ password_hash: newHash })
      .where('id', '=', found.userId)
      .execute()
    await trx
      .updateTable('auth_one_time_tokens')
      .set({ consumed_at: new Date() })
      .where('id', '=', found.id)
      .execute()
    // Defense: revoke all unconsumed tokens of both kinds for this user.
    await trx
      .updateTable('auth_one_time_tokens')
      .set({ consumed_at: new Date() })
      .where('user_id', '=', found.userId)
      .where('consumed_at', 'is', null)
      .execute()
  })
  try {
    await sendPasswordChanged(
      { emailSender: deps.emailSender },
      { email: userEmail, at: new Date(), ip: request.ip },
    )
  } catch (err) {
    request.log.warn(
      { err, event: 'email_send_failed', purpose: 'password_changed_notification' },
      'email send failed',
    )
  }
  return { ok: true }
})
```

### Step 3: Create `apps/server/test/auth/password-reset.test.ts`

```ts
import { describe, expect, test, beforeAll, afterAll, beforeEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import { sql } from 'kysely'
import {
  authRoutes,
  resolveAuthContext,
  type AuthMiddlewareDeps,
} from '../../src/modules/auth/index.js'
import { dbTenantPlugin } from '../../src/modules/db-tenant/index.js'
import { MockEmailSender } from '../../src/modules/email/index.js'
import { createTestDb, createAppRoleTestDb, truncateAll } from '../helpers/db.js'

const JWT_SECRET = 'test-secret-at-least-32-chars-long-x'

describe('password reset routes', () => {
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

  async function register(email: string): Promise<void> {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email, password: 'password123' },
    })
    expect(res.statusCode).toBe(200)
  }

  test('POST /auth/password-reset/request — returns 200 for unknown email, no email sent', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/password-reset/request',
      payload: { email: 'noone@test.com' },
    })
    expect(res.statusCode).toBe(200)
    expect(sender.sent.filter((m) => m.subject.startsWith('Reset'))).toHaveLength(0)
  })

  test('POST /auth/password-reset/request — known user → one reset email', async () => {
    await register('r1@test.com')
    sender.sent.length = 0
    const res = await app.inject({
      method: 'POST',
      url: '/auth/password-reset/request',
      payload: { email: 'r1@test.com' },
    })
    expect(res.statusCode).toBe(200)
    const resetMsgs = sender.sent.filter((m) => m.subject.includes('Reset'))
    expect(resetMsgs).toHaveLength(1)
  })

  test('POST /auth/password-reset/confirm — happy path: new password works for login', async () => {
    await register('r2@test.com')
    sender.sent.length = 0
    await app.inject({
      method: 'POST',
      url: '/auth/password-reset/request',
      payload: { email: 'r2@test.com' },
    })
    const token = new URL(
      sender.sent.find((m) => m.subject.includes('Reset'))!.text.match(/http[^\s]+/)![0],
    ).searchParams.get('token')!
    const res = await app.inject({
      method: 'POST',
      url: '/auth/password-reset/confirm',
      payload: { token, newPassword: 'newpassword99' },
    })
    expect(res.statusCode).toBe(200)
    // Login with new pwd should succeed:
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'r2@test.com', password: 'newpassword99' },
    })
    expect(login.statusCode).toBe(200)
    // Login with old pwd should fail:
    const old = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'r2@test.com', password: 'password123' },
    })
    expect(old.statusCode).toBe(401)
  })

  test('POST /auth/password-reset/confirm — invalid token returns 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/password-reset/confirm',
      payload: { token: 'reset_garbage', newPassword: 'newpassword99' },
    })
    expect(res.statusCode).toBe(400)
  })

  test('POST /auth/password-reset/confirm — sends courtesy passwordChanged email', async () => {
    await register('r3@test.com')
    sender.sent.length = 0
    await app.inject({
      method: 'POST',
      url: '/auth/password-reset/request',
      payload: { email: 'r3@test.com' },
    })
    const token = new URL(
      sender.sent.find((m) => m.subject.includes('Reset'))!.text.match(/http[^\s]+/)![0],
    ).searchParams.get('token')!
    sender.sent.length = 0
    await app.inject({
      method: 'POST',
      url: '/auth/password-reset/confirm',
      payload: { token, newPassword: 'newpassword99' },
    })
    expect(sender.sent.find((m) => m.subject.includes('changed'))).toBeDefined()
  })

  test('POST /auth/password-reset/confirm — also revokes pending email-verify token', async () => {
    await register('r4@test.com')
    sender.sent.length = 0
    // Issue an email-verify token first.
    await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'r4@test.com', password: 'password123' },
    })
    const loginCookie = (
      await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { email: 'r4@test.com', password: 'password123' },
      })
    ).cookies[0]!
    sender.sent.length = 0
    await app.inject({
      method: 'POST',
      url: '/auth/email-verify/request',
      headers: { cookie: `${loginCookie.name}=${loginCookie.value}` },
    })
    const verifyToken = new URL(
      sender.sent.find((m) => m.subject.includes('Verify'))!.text.match(/http[^\s]+/)![0],
    ).searchParams.get('token')!
    // Now run reset request + confirm.
    sender.sent.length = 0
    await app.inject({
      method: 'POST',
      url: '/auth/password-reset/request',
      payload: { email: 'r4@test.com' },
    })
    const resetToken = new URL(
      sender.sent.find((m) => m.subject.includes('Reset'))!.text.match(/http[^\s]+/)![0],
    ).searchParams.get('token')!
    await app.inject({
      method: 'POST',
      url: '/auth/password-reset/confirm',
      payload: { token: resetToken, newPassword: 'newpassword99' },
    })
    // The previously issued verify token should now be unusable.
    const reuse = await app.inject({
      method: 'POST',
      url: '/auth/email-verify/confirm',
      payload: { token: verifyToken },
    })
    expect(reuse.statusCode).toBe(400)
  })
})
```

### Step 4: Run

```bash
pnpm db:up
sleep 5
pnpm --filter @argus/server test test/auth/password-reset.test.ts 2>&1 | tail -25
pnpm db:down
```

Expected: 6 tests pass.

### Step 5: Commit

```bash
git add apps/server/src/modules/auth/routes.ts apps/server/src/modules/auth/dao.ts \
        apps/server/test/auth/password-reset.test.ts
git commit -m "feat(server): m8 /auth/password-reset routes — request + confirm + courtesy email"
```

---

## Task 8: register hook + `/auth/me` extension + auth tests update

**Files:**

- Modify: `apps/server/src/modules/auth/routes.ts`
- Modify: `apps/server/src/modules/auth/middleware.ts`
- Modify: `apps/server/src/modules/auth/types.ts`
- Modify: `apps/server/src/modules/auth/dao.ts`
- Modify: `apps/server/test/auth/routes.test.ts`

### Step 1: Modify `apps/server/src/modules/auth/types.ts`

Add `emailVerifiedAt: string | null` to the user type:

```ts
export interface AuthUser {
  id: string
  email: string
  orgId: string
  emailVerifiedAt: string | null
}
```

(Adjust the existing interface — if it's named `User` or similar, keep the existing name; just add the field.)

### Step 2: Modify `apps/server/src/modules/auth/dao.ts`

Update `findUserByEmail`, `findUserById`, and `UserRecord` to carry `emailVerifiedAt`:

```ts
export interface UserRecord {
  id: string
  email: string
  passwordHash: string
  orgId: string
  emailVerifiedAt: Date | null
}
```

In each find query, add `'u.email_verified_at as emailVerifiedAt'` to the select. Map the value to a Date (`new Date(row.emailVerifiedAt)`) or null. `createUser` should return `emailVerifiedAt: null` for new users.

### Step 3: Modify `apps/server/src/modules/auth/middleware.ts`

Where `request.auth = { user: { … } }` is set (twice in the file — multi-tenant and local), include `emailVerifiedAt: record.emailVerifiedAt?.toISOString() ?? null`.

### Step 4: Modify `apps/server/src/modules/auth/routes.ts`

In the `/auth/register` handler — after the existing `await app.withTenantTx(...auditRecord)`, add a fire-and-forget verify-email call:

```ts
try {
  await issueAndSendEmailVerify(
    { db: deps.db, emailSender: deps.emailSender, appBaseUrl: deps.appBaseUrl },
    { userId: record.id, email: record.email },
  )
} catch (err) {
  request.log.warn(
    { err, event: 'email_send_failed', purpose: 'register_verify' },
    'email send failed',
  )
}
```

Update the register response to include `emailVerifiedAt: null`:

```ts
return { user: { id: record.id, email: record.email, orgId: record.orgId, emailVerifiedAt: null } }
```

Same for the login response — add `emailVerifiedAt: record.emailVerifiedAt?.toISOString() ?? null`.

`/auth/me` already returns `request.auth.user` which now has the field.

### Step 5: Modify `apps/server/test/auth/routes.test.ts`

The existing tests' fixture (`makeApp(...)`) needs an `emailSender` opt:

```ts
async function makeApp(opts?: { userId?: string }): Promise<{ app, sender: MockEmailSender, ... }> {
  // …
  const sender = new MockEmailSender()
  await app.register(authRoutes, {
    // … existing fields …
    emailSender: sender,
    appBaseUrl: 'http://localhost:5173',
  })
  return { app, sender, ... }
}
```

Add a new test: register sends one verify email.

```ts
test('register fires a verification email', async () => {
  const { app, sender } = await makeApp()
  await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email: 'new@test.com', password: 'password123' },
  })
  const verifyMsgs = sender.sent.filter((m) => m.subject.includes('Verify'))
  expect(verifyMsgs).toHaveLength(1)
  expect(verifyMsgs[0]!.to).toBe('new@test.com')
})

test('register still returns 200 when email send throws', async () => {
  const { app, sender } = await makeApp()
  sender.throwOnSend = true
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email: 'throws@test.com', password: 'password123' },
  })
  expect(res.statusCode).toBe(200)
})

test('GET /auth/me — exposes emailVerifiedAt', async () => {
  const { app } = await makeApp()
  const reg = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email: 'me@test.com', password: 'password123' },
  })
  const cookie = reg.cookies[0]!
  const me = await app.inject({
    method: 'GET',
    url: '/auth/me',
    headers: { cookie: `${cookie.name}=${cookie.value}` },
  })
  const body = JSON.parse(me.body)
  expect(body.user.emailVerifiedAt).toBeNull()
})
```

### Step 6: Run

```bash
pnpm db:up
sleep 5
pnpm --filter @argus/server typecheck 2>&1 | tail -10
pnpm --filter @argus/server test test/auth 2>&1 | tail -25
pnpm db:down
```

Expected: typecheck clean; auth suite all green (existing + 3 new tests).

### Step 7: Commit

```bash
git add apps/server/src/modules/auth/routes.ts \
        apps/server/src/modules/auth/middleware.ts \
        apps/server/src/modules/auth/types.ts \
        apps/server/src/modules/auth/dao.ts \
        apps/server/test/auth/routes.test.ts
git commit -m "feat(server): m8 register hook + /auth/me carries emailVerifiedAt"
```

---

## Task 9: web — auth-provider type + login Forgot link + i18n keys

**Files:**

- Modify: `apps/web/src/lib/auth-provider.tsx`
- Modify: `apps/web/src/routes/login.tsx`
- Modify: `apps/web/src/i18n/locales/en.json`
- Modify: `apps/web/src/i18n/locales/zh-CN.json`
- Modify: `apps/web/src/i18n/locales/ja.json`

### Step 1: Modify `apps/web/src/lib/auth-provider.tsx`

Update the `User` type to include `emailVerifiedAt: string | null`:

```ts
export interface User {
  id: string
  email: string
  orgId: string
  emailVerifiedAt: string | null
}
```

### Step 2: Modify `apps/web/src/routes/login.tsx`

Add a `<Link to="/auth/forgot-password">{t('auth.login.forgot')}</Link>` below the submit button. Use the existing form pattern.

### Step 3: Modify `apps/web/src/i18n/locales/en.json`

Add to `auth.login`:

```json
"forgot": "Forgot password?"
```

Add new top-level paths:

```json
"auth": {
  "login": { "...": "...", "forgot": "Forgot password?" },
  "verifyEmail": {
    "verifying": "Verifying…",
    "success": "✓ Email verified.",
    "failed": "✗ This link is invalid or expired.",
    "goLogin": "Go to login",
    "goSessions": "Go to sessions"
  },
  "forgotPassword": {
    "title": "Reset your password",
    "email": "Email",
    "submit": "Send reset link",
    "submitting": "Sending…",
    "confirmation": "If that email exists in our records, we've sent a reset link.",
    "backToLogin": "Back to login"
  },
  "resetPassword": {
    "title": "Choose a new password",
    "newPassword": "New password (min 8 chars)",
    "submit": "Update password",
    "submitting": "Updating…",
    "success": "Password updated. Sign in with your new password.",
    "failed": "This link is invalid or expired. Request a new one.",
    "requestAnother": "Request another reset link"
  }
}
```

Add to `shell`:

```json
"verifyNag": {
  "message": "Please verify your email — check your inbox.",
  "resend": "Resend",
  "resent": "Sent. Check your inbox.",
  "dismiss": "Dismiss"
}
```

### Step 4: Modify `apps/web/src/i18n/locales/zh-CN.json` — mirror with translations

```json
"auth": {
  "login": { "forgot": "忘记密码？" },
  "verifyEmail": {
    "verifying": "验证中…",
    "success": "✓ 邮箱已验证。",
    "failed": "✗ 链接无效或已过期。",
    "goLogin": "前往登录",
    "goSessions": "前往会话"
  },
  "forgotPassword": {
    "title": "重置密码",
    "email": "邮箱",
    "submit": "发送重置链接",
    "submitting": "发送中…",
    "confirmation": "如果该邮箱在我们记录中存在，我们已发送重置链接。",
    "backToLogin": "返回登录"
  },
  "resetPassword": {
    "title": "设置新密码",
    "newPassword": "新密码（至少 8 位）",
    "submit": "更新密码",
    "submitting": "更新中…",
    "success": "密码已更新，请用新密码登录。",
    "failed": "链接无效或已过期，请重新申请。",
    "requestAnother": "重新申请重置链接"
  }
}
```

Add to `shell`:

```json
"verifyNag": {
  "message": "请验证您的邮箱 — 查看收件箱。",
  "resend": "重新发送",
  "resent": "已发送，请查收。",
  "dismiss": "关闭"
}
```

### Step 5: Modify `apps/web/src/i18n/locales/ja.json` — mirror with translations

```json
"auth": {
  "login": { "forgot": "パスワードをお忘れですか？" },
  "verifyEmail": {
    "verifying": "確認中…",
    "success": "✓ メールアドレスを確認しました。",
    "failed": "✗ このリンクは無効か期限切れです。",
    "goLogin": "サインインへ",
    "goSessions": "セッション一覧へ"
  },
  "forgotPassword": {
    "title": "パスワードをリセット",
    "email": "メールアドレス",
    "submit": "リセットリンクを送信",
    "submitting": "送信中…",
    "confirmation": "このメールアドレスが登録されている場合、リセットリンクをお送りしました。",
    "backToLogin": "サインインへ戻る"
  },
  "resetPassword": {
    "title": "新しいパスワードを設定",
    "newPassword": "新しいパスワード（8文字以上）",
    "submit": "パスワードを更新",
    "submitting": "更新中…",
    "success": "パスワードを更新しました。新しいパスワードでサインインしてください。",
    "failed": "このリンクは無効か期限切れです。再度リクエストしてください。",
    "requestAnother": "リセットリンクを再リクエスト"
  }
}
```

Add to `shell`:

```json
"verifyNag": {
  "message": "メールアドレスをご確認ください — 受信トレイをチェック。",
  "resend": "再送信",
  "resent": "送信しました。受信トレイをご確認ください。",
  "dismiss": "閉じる"
}
```

### Step 6: Run

```bash
pnpm --filter @argus/web typecheck
pnpm --filter @argus/web build 2>&1 | tail -10
```

Expected: 0 errors. Build emits the new bundles.

### Step 7: Commit

```bash
git add apps/web/src/lib/auth-provider.tsx apps/web/src/routes/login.tsx \
        apps/web/src/i18n/locales
git commit -m "feat(web): m8 i18n keys + emailVerifiedAt + forgot-password link"
```

---

## Task 10: web — `/auth/verify-email`, `/auth/forgot-password`, `/auth/reset-password` routes

**Files:**

- Create: `apps/web/src/routes/auth.verify-email.tsx`
- Create: `apps/web/src/routes/auth.forgot-password.tsx`
- Create: `apps/web/src/routes/auth.reset-password.tsx`

> Note: TanStack file-based router treats dotted file names as nested URL segments — `auth.verify-email.tsx` → `/auth/verify-email`. Match the existing convention used in M5 (`login.tsx` = `/login`, `register.tsx` = `/register`).

### Step 1: Create `apps/web/src/routes/auth.verify-email.tsx`

```tsx
import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'

const searchSchema = z.object({ token: z.string().optional() })

export const Route = createFileRoute('/auth/verify-email')({
  validateSearch: searchSchema,
  component: VerifyEmailPage,
})

type State = 'verifying' | 'success' | 'failed'

function VerifyEmailPage() {
  const { t } = useTranslation()
  const { token } = Route.useSearch()
  const [state, setState] = useState<State>('verifying')

  useEffect(() => {
    let cancelled = false
    async function confirm() {
      if (!token) {
        setState('failed')
        return
      }
      try {
        const res = await fetch('/auth/email-verify/confirm', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token }),
        })
        if (cancelled) return
        setState(res.ok ? 'success' : 'failed')
      } catch {
        if (!cancelled) setState('failed')
      }
    }
    void confirm()
    return () => {
      cancelled = true
    }
  }, [token])

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-page">
      <div className="w-full max-w-sm space-y-4 border border-hairline rounded p-6 text-center">
        {state === 'verifying' && (
          <p className="u-body text-text-2">{t('auth.verifyEmail.verifying')}</p>
        )}
        {state === 'success' && (
          <>
            <p className="u-h-lg text-success">{t('auth.verifyEmail.success')}</p>
            <Link to="/sessions" className="u-body text-brand hover:text-brand-hover">
              {t('auth.verifyEmail.goSessions')}
            </Link>
          </>
        )}
        {state === 'failed' && (
          <>
            <p className="u-h-lg text-danger">{t('auth.verifyEmail.failed')}</p>
            <Link to="/login" className="u-body text-brand hover:text-brand-hover">
              {t('auth.verifyEmail.goLogin')}
            </Link>
          </>
        )}
      </div>
    </div>
  )
}
```

### Step 2: Create `apps/web/src/routes/auth.forgot-password.tsx`

```tsx
import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export const Route = createFileRoute('/auth/forgot-password')({
  component: ForgotPasswordPage,
})

function ForgotPasswordPage() {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    try {
      await fetch('/auth/password-reset/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      setDone(true)
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
        <h1 className="u-h-xl text-text-1">{t('auth.forgotPassword.title')}</h1>
        {done ? (
          <p className="u-body text-text-2">{t('auth.forgotPassword.confirmation')}</p>
        ) : (
          <>
            <label className="block space-y-1">
              <span className="u-caption text-text-3">{t('auth.forgotPassword.email')}</span>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-8 w-full rounded border border-hairline px-3 u-body text-text-1 bg-page focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-1"
              />
            </label>
            <button
              type="submit"
              disabled={submitting}
              className="w-full h-8 rounded bg-brand text-white u-body hover:bg-brand-hover transition-colors disabled:opacity-50"
            >
              {submitting ? t('auth.forgotPassword.submitting') : t('auth.forgotPassword.submit')}
            </button>
          </>
        )}
        <p className="u-caption text-text-3 text-center">
          <Link to="/login" className="text-brand hover:text-brand-hover">
            {t('auth.forgotPassword.backToLogin')}
          </Link>
        </p>
      </form>
    </div>
  )
}
```

### Step 3: Create `apps/web/src/routes/auth.reset-password.tsx`

```tsx
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'

const searchSchema = z.object({ token: z.string().optional() })

export const Route = createFileRoute('/auth/reset-password')({
  validateSearch: searchSchema,
  component: ResetPasswordPage,
})

function ResetPasswordPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { token } = Route.useSearch()
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!token) {
      setError(t('auth.resetPassword.failed'))
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/auth/password-reset/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, newPassword: password }),
      })
      if (!res.ok) {
        setError(t('auth.resetPassword.failed'))
      } else {
        setSuccess(true)
        setTimeout(() => navigate({ to: '/login' }), 1500)
      }
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
        <h1 className="u-h-xl text-text-1">{t('auth.resetPassword.title')}</h1>
        {success ? (
          <p className="u-body text-success">{t('auth.resetPassword.success')}</p>
        ) : (
          <>
            <label className="block space-y-1">
              <span className="u-caption text-text-3">{t('auth.resetPassword.newPassword')}</span>
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-8 w-full rounded border border-hairline px-3 u-body text-text-1 bg-page focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-1"
              />
            </label>
            {error && <p className="u-caption text-danger">{error}</p>}
            <button
              type="submit"
              disabled={submitting || !token}
              className="w-full h-8 rounded bg-brand text-white u-body hover:bg-brand-hover transition-colors disabled:opacity-50"
            >
              {submitting ? t('auth.resetPassword.submitting') : t('auth.resetPassword.submit')}
            </button>
            {error && (
              <p className="u-caption text-center">
                <Link to="/auth/forgot-password" className="text-brand hover:text-brand-hover">
                  {t('auth.resetPassword.requestAnother')}
                </Link>
              </p>
            )}
          </>
        )}
      </form>
    </div>
  )
}
```

### Step 4: Run

```bash
pnpm --filter @argus/web typecheck
pnpm --filter @argus/web build 2>&1 | tail -10
```

Expected: 0 errors; routes generated by tanstack-router-plugin.

### Step 5: Commit

```bash
git add apps/web/src/routes/auth.verify-email.tsx \
        apps/web/src/routes/auth.forgot-password.tsx \
        apps/web/src/routes/auth.reset-password.tsx
git commit -m "feat(web): m8 verify-email + forgot-password + reset-password routes"
```

---

## Task 11: `VerifyNagBar` + mount in `__root.tsx`

**Files:**

- Create: `apps/web/src/features/email-verify-nag/VerifyNagBar.tsx`
- Modify: `apps/web/src/routes/__root.tsx`

### Step 1: Create `apps/web/src/features/email-verify-nag/VerifyNagBar.tsx`

```tsx
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../lib/auth-provider'

const DISMISS_KEY = 'argus.verifyNagDismissed'

export function VerifyNagBar() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [dismissed, setDismissed] = useState(
    () => typeof sessionStorage !== 'undefined' && sessionStorage.getItem(DISMISS_KEY) === '1',
  )
  const [resent, setResent] = useState(false)
  const [resending, setResending] = useState(false)

  if (!user || user.emailVerifiedAt !== null || dismissed) return null

  async function onResend() {
    setResending(true)
    try {
      await fetch('/auth/email-verify/request', { method: 'POST' })
      setResent(true)
      setTimeout(() => setResent(false), 5000)
    } finally {
      setResending(false)
    }
  }

  function onDismiss() {
    sessionStorage.setItem(DISMISS_KEY, '1')
    setDismissed(true)
  }

  return (
    <div className="bg-tint-warning border-b border-hairline px-6 py-2 flex items-center gap-3 u-body text-text-1">
      <span className="flex-1">
        {resent ? t('shell.verifyNag.resent') : t('shell.verifyNag.message')}
      </span>
      <button
        type="button"
        onClick={onResend}
        disabled={resending || resent}
        className="u-caption text-brand hover:text-brand-hover disabled:opacity-50"
      >
        {t('shell.verifyNag.resend')}
      </button>
      <button type="button" onClick={onDismiss} className="u-caption text-text-3 hover:text-text-1">
        {t('shell.verifyNag.dismiss')}
      </button>
    </div>
  )
}
```

> **CSS note:** `bg-tint-warning` is part of the M5a UniFi token set (warning-tint utility). If it's not present, fall back to `bg-yellow-50` Tailwind class or add a new utility in `index.css`.

### Step 2: Modify `apps/web/src/routes/__root.tsx`

Import + mount the bar between the `<header>` and `<main>`:

```tsx
import { VerifyNagBar } from '../features/email-verify-nag/VerifyNagBar'
// inside the Shell layout, after the header:
<header>…existing header…</header>
<VerifyNagBar />
<main className="flex-1 overflow-hidden">
  <Outlet />
</main>
```

### Step 3: Run

```bash
pnpm --filter @argus/web typecheck
pnpm --filter @argus/web build 2>&1 | tail -10
```

Expected: 0 errors; build clean.

### Step 4: Commit

```bash
git add apps/web/src/features/email-verify-nag apps/web/src/routes/__root.tsx
git commit -m "feat(web): m8 email verification nag bar in shell"
```

---

## Task 12: CLAUDE.md + final pipeline + tag m8-email-flows

**Files:**

- Modify: `/Users/fooevr/Code/argus/CLAUDE.md`

### Step 1: Update CLAUDE.md

Read it first to locate sections. Append to "Common pitfalls":

```
- **Sending email from a route handler:** use `app.emailSender.send(...)` via the Fastify decorator from the email module. Wrap in try/catch when the operation is best-effort (e.g., register's verification email); let it surface when the user explicitly triggered it (e.g., `/auth/password-reset/request`). Tests use MockEmailSender via the existing DI pattern.
```

Append to "Working rules":

```
- **Adding a new auth one-time-token kind:** extend `TokenKind` in `apps/server/src/modules/auth-tokens/types.ts`, write an `issueAndSend<Kind>` helper in `apps/server/src/modules/auth/email-flows.ts`, add a public confirm route, write the matching integration test under `apps/server/test/auth/`. Don't pile new kinds into existing helpers.
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

Expected: all exit 0. Server tests: 94 + ~25 = ~119. Web tests: 14. Total: ~133.

### Step 3: Commit + tag

```bash
git add CLAUDE.md
git commit -m "docs(claude): m8 email module + token-kind how-to"

git tag -a m8-email-flows -m "M8 email verification + password reset

- Resend SDK behind injectable EmailSender (MockEmailSender for tests)
- Polymorphic auth_one_time_tokens table (kind = email_verify | password_reset)
- 4 server routes: email-verify/{request,confirm}, password-reset/{request,confirm}
- /auth/register fire-and-forgets verification email (non-blocking)
- /auth/me carries emailVerifiedAt
- 3 web routes + VerifyNagBar in shell; en/zh-CN/ja i18n
- 60s issue rate limit per (user, kind); confirm-reset revokes all unconsumed tokens
- ~133 tests pass; web bundle adds ~3 routes + nag bar component
"

git push origin main 2>&1 | tail -10
git push origin m8-email-flows 2>&1 | tail -5
```

### Step 4: Confirm CI green at https://github.com/tiven-ai/Argus/actions

### Step 5: Visual smoke (controller)

Open the app via Claude Preview:

- Register a new user → see nag bar
- Click "Resend" → "Sent. Check your inbox." appears
- Open the dev server log or your Resend inbox → grab the link → paste into browser → "Email verified" → nag bar gone
- `/auth/forgot-password` form → submit → uniform confirmation
- Open reset email → land on `/auth/reset-password?token=…` → submit new password → "Password updated" → log in with new password

---

## Acceptance Summary

M8 is done when:

- [ ] `pnpm install / typecheck / lint / test / build` all exit 0
- [ ] All M7 tests (94 server, 14 web) still pass; M8 adds ≥25 new server tests across auth-tokens, email, email-flows, email-verify routes, password-reset routes, register integration
- [ ] `users.email_verified_at` column exists; `auth_one_time_tokens` table exists with both partial indexes; `argus_app` has CRUD on the new table
- [ ] `app.emailSender` decorator available; `createServer` accepts optional `emailSender` opt for test injection
- [ ] `/auth/register` returns 200 even when MockEmailSender throws
- [ ] `/auth/me` returns `emailVerifiedAt` field (null for unverified, ISO string otherwise)
- [ ] VerifyNagBar shown when `user.emailVerifiedAt === null`; dismissible per session
- [ ] All new strings translated in en / zh-CN / ja
- [ ] Tag `m8-email-flows` pushed; CI green

Once M8 lands, the remaining backlog is: M9 (multi-user-per-org), email body i18n, session invalidation on password reset, token cleanup job, and the M3/M5a/M6 small leftovers.
