# Argus M4 (Compact) — Multi-Tenant + Public Registration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Argus a working multi-tenant system: a new user can register with email+password, create a project, mint an ingest token, push an OTLP trace, and see only their own sessions. A second account cannot see the first account's data.

**Architecture:** Add `users`, `org_members`, `ingest_tokens` tables (migration 0002). Two parallel auth surfaces: (a) UI/query API uses `@fastify/cookie` + JWT in HTTP-only cookie, mapped to a user → primary org via `org_members`; (b) Ingest API uses `Authorization: Bearer <ingest_token>` (high-entropy random, sha256-hashed at rest), mapped directly to the token's project's org. `ARGUS_MODE=local` (default) keeps the current zero-config dev experience by auto-authenticating as a hardcoded `default-user` in `default-org`; `ARGUS_MODE=multi-tenant` enforces real auth on every request. Web app gets an `AuthProvider`, `/login` + `/register` routes, a settings page for tokens, and topbar user menu.

**Scope deliberately excluded (post-M4 hardening):**

- Email verification (real email send infra — verification _tokens_ mechanism left as a hook)
- PG row-level security policies (app-layer enforcement is the primary; RLS is defense-in-depth)
- Audit log table for sensitive events
- Password reset flow
- Multi-user membership in one org (compact M4: every user owns exactly one personal org)
- 2FA / SSO / OIDC

**Tech Stack additions:**

- `bcryptjs` (pure JS, no node-gyp build deps) for password hashing
- `jsonwebtoken` for HS256-signed cookie JWTs
- `@fastify/cookie` plugin for cookie parsing
- No new web dependencies — forms use plain `useState`; dropdown is a custom inline component

**Reference spec:** [docs/superpowers/specs/2026-05-28-argus-design.md](../specs/2026-05-28-argus-design.md) section 6

---

## File Structure (after this plan)

```
apps/server/
├── src/
│   ├── env.ts                              (MODIFIED: add JWT_SECRET + COOKIE_NAME)
│   ├── constants.ts                        (MODIFIED: add DEFAULT_USER_ID)
│   ├── server.ts                           (MODIFIED: register cookie plugin + auth/token modules)
│   ├── db/
│   │   ├── schema.ts                       (MODIFIED: add Users/OrgMembers/IngestTokens types)
│   │   └── migrations/
│   │       └── 0002_auth.ts                (NEW)
│   └── modules/
│       ├── auth/                           (NEW)
│       │   ├── index.ts
│       │   ├── types.ts                    (AuthContext, AuthUser)
│       │   ├── password.ts                 (hashPassword / verifyPassword)
│       │   ├── jwt.ts                      (signJwt / verifyJwt)
│       │   ├── dao.ts                      (createUser / findUserByEmail / findUserById / ensureLocalDefaultUser / findUserOrgId)
│       │   ├── middleware.ts               (resolveAuthContext: cookie -> user -> orgId)
│       │   └── routes.ts                   (register / login / logout / me)
│       ├── tokens/                         (NEW)
│       │   ├── index.ts
│       │   ├── helpers.ts                  (generateToken / hashToken / parseAuthHeader)
│       │   ├── dao.ts                      (createToken / listTokensForOrg / revokeToken / resolveTokenContext)
│       │   ├── middleware.ts               (resolveIngestContext: bearer -> {orgId, projectId})
│       │   └── routes.ts                   (GET/POST/DELETE token endpoints + GET/POST projects)
│       ├── api/
│       │   └── routes.ts                   (MODIFIED: orgId from auth context, not hardcoded)
│       ├── ingest/
│       │   └── routes.ts                   (MODIFIED: orgId from token context; project/service auto-create rules updated)
│       └── pusher/
│           └── routes.ts                   (MODIFIED: orgId from auth context)
└── test/
    ├── auth/
    │   ├── password.test.ts                (NEW)
    │   ├── jwt.test.ts                     (NEW)
    │   ├── routes.test.ts                  (NEW)
    │   └── middleware.test.ts              (NEW)
    ├── tokens/
    │   ├── helpers.test.ts                 (NEW)
    │   ├── routes.test.ts                  (NEW)
    │   └── middleware.test.ts              (NEW)
    └── isolation/
        └── cross-org.test.ts               (NEW: 2 users, can't see each other's data)

apps/web/
└── src/
    ├── lib/
    │   ├── api.ts                          (MODIFIED: add auth + token + projects API)
    │   └── auth-provider.tsx               (NEW)
    └── routes/
        ├── __root.tsx                      (MODIFIED: wrap AuthProvider + user menu + protected pattern)
        ├── login.tsx                       (NEW)
        ├── register.tsx                    (NEW)
        └── settings/
            ├── tokens.tsx                  (NEW: list/create/revoke with reveal-once)
            └── route.tsx                   (NEW: layout for /settings/*)
```

---

## Common Conventions

- All imports use `.js` extensions on the server side (NodeNext).
- Auth cookie name: `argus_session` (HTTP-only, SameSite=Lax). Configurable via env.
- JWT alg: HS256. Default JWT secret in env required in `multi-tenant` mode; ignored in `local` mode (still parsed though, so env always sets it).
- Ingest token format: `argus_<32-hex-chars>` (38 chars total). sha256-hashed at rest; display prefix is the first 12 chars (`argus_xxxxxx`).
- Commit messages: Conventional Commits, lowercase subject (commitlint enforces).
- Local mode default user UUID: `11111111-1111-1111-1111-111111111111`.

---

## Task 1: Schema migration 0002 + schema.ts

**Files:**

- Create: `apps/server/src/db/migrations/0002_auth.ts`
- Modify: `apps/server/src/db/schema.ts`
- Modify: `apps/server/src/constants.ts`

### Step 1: Modify `apps/server/src/constants.ts`

```ts
/**
 * Single-tenant default org id used while `ARGUS_MODE=local`.
 * Replaced by per-request orgId resolution in M4.
 */
export const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000000'

/**
 * Single-tenant default user id used while `ARGUS_MODE=local`.
 * Created by migration 0002 and ensured at server startup.
 */
export const DEFAULT_USER_ID = '11111111-1111-1111-1111-111111111111'

export const DEFAULT_USER_EMAIL = 'local@argus.dev'
```

### Step 2: Create `apps/server/src/db/migrations/0002_auth.ts`

```ts
import { type Kysely, sql } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('users')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('email', 'varchar(255)', (col) => col.notNull().unique())
    .addColumn('password_hash', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute()

  // Insert the default-user row for ARGUS_MODE=local. The password_hash is a
  // sentinel that can never match a bcryptjs comparison (length is wrong).
  await sql`
    INSERT INTO users (id, email, password_hash)
    VALUES ('11111111-1111-1111-1111-111111111111', 'local@argus.dev', '$local$')
    ON CONFLICT DO NOTHING
  `.execute(db)

  await db.schema
    .createTable('org_members')
    .addColumn('user_id', 'uuid', (col) => col.notNull().references('users.id').onDelete('cascade'))
    .addColumn('org_id', 'uuid', (col) => col.notNull().references('orgs.id').onDelete('cascade'))
    .addColumn('role', 'varchar(50)', (col) => col.notNull().defaultTo('owner'))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addPrimaryKeyConstraint('org_members_pk', ['user_id', 'org_id'])
    .execute()

  // Link the default-user to the default-org.
  await sql`
    INSERT INTO org_members (user_id, org_id, role)
    VALUES ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'owner')
    ON CONFLICT DO NOTHING
  `.execute(db)

  await db.schema
    .createTable('ingest_tokens')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('project_id', 'uuid', (col) =>
      col.notNull().references('projects.id').onDelete('cascade'),
    )
    .addColumn('name', 'varchar(255)', (col) => col.notNull())
    .addColumn('token_prefix', 'varchar(16)', (col) => col.notNull())
    .addColumn('token_hash', 'text', (col) => col.notNull().unique())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('revoked_at', 'timestamptz')
    .execute()

  await sql`CREATE INDEX idx_ingest_tokens_hash_active ON ingest_tokens(token_hash) WHERE revoked_at IS NULL`.execute(
    db,
  )
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('ingest_tokens').execute()
  await db.schema.dropTable('org_members').execute()
  await db.schema.dropTable('users').execute()
}
```

### Step 3: Modify `apps/server/src/db/schema.ts` — add the three new table interfaces and extend `DB`

Append the following interfaces BEFORE the `DB` interface (anywhere in the file is fine; keep alphabetical-ish):

```ts
export interface Users {
  id: Generated<string>
  email: string
  password_hash: string
  created_at: Generated<Timestamp>
}

export interface OrgMembers {
  user_id: string
  org_id: string
  role: Generated<string>
  created_at: Generated<Timestamp>
}

export interface IngestTokens {
  id: Generated<string>
  project_id: string
  name: string
  token_prefix: string
  token_hash: string
  created_at: Generated<Timestamp>
  revoked_at: Timestamp | null
}
```

Update the `DB` interface to include all three:

```ts
export interface DB {
  orgs: Orgs
  projects: Projects
  services: Services
  sessions: Sessions
  steps: Steps
  step_events: StepEvents
  users: Users
  org_members: OrgMembers
  ingest_tokens: IngestTokens
}
```

### Step 4: Smoke-test the migration

```bash
pnpm db:up
sleep 5
pnpm db:migrate

docker exec argus-postgres psql -U argus -d argus -c "\dt"
docker exec argus-postgres psql -U argus -d argus -c "SELECT id, email FROM users;"
docker exec argus-postgres psql -U argus -d argus -c "SELECT user_id, org_id, role FROM org_members;"
docker exec argus-postgres psql -U argus -d argus -c "SELECT COUNT(*) FROM ingest_tokens;"

pnpm db:down
```

Expected:

- 9 user tables (was 6) + kysely's own tracking tables
- 1 user row with email `local@argus.dev`
- 1 org_member row linking default user to default org
- 0 ingest tokens

### Step 5: Commit

```bash
git add apps/server/src/db apps/server/src/constants.ts
git commit -m "feat(server): migration 0002 — users + org_members + ingest_tokens"
```

---

## Task 2: Auth deps + password + JWT helpers + tests

**Files:**

- Modify: `apps/server/package.json` (add `bcryptjs`, `jsonwebtoken`, `@fastify/cookie`, types)
- Modify: `apps/server/src/env.ts` (add JWT_SECRET + COOKIE_NAME)
- Create: `apps/server/src/modules/auth/password.ts`
- Create: `apps/server/src/modules/auth/jwt.ts`
- Create: `apps/server/test/auth/password.test.ts`
- Create: `apps/server/test/auth/jwt.test.ts`

### Step 1: Replace `apps/server/package.json`

```json
{
  "name": "@argus/server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "dist/main.js",
  "scripts": {
    "dev": "tsx watch src/main.ts",
    "build": "tsc -p tsconfig.build.json",
    "start": "node dist/main.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint src test",
    "typecheck": "tsc --noEmit",
    "db:migrate": "tsx src/db/migrate.ts",
    "db:codegen": "kysely-codegen --out-file src/db/schema.ts --dialect postgres",
    "db:seed": "tsx src/cli/seed.ts"
  },
  "dependencies": {
    "@argus/shared-types": "workspace:*",
    "@fastify/cookie": "^11.0.0",
    "bcryptjs": "^2.4.3",
    "fastify": "^5.0.0",
    "jsonwebtoken": "^9.0.0",
    "kysely": "^0.27.0",
    "pg": "^8.13.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@argus/eslint-config": "workspace:*",
    "@argus/tsconfig": "workspace:*",
    "@testcontainers/postgresql": "^10.0.0",
    "@types/bcryptjs": "^2.4.6",
    "@types/jsonwebtoken": "^9.0.0",
    "@types/node": "^22.0.0",
    "@types/pg": "^8.11.0",
    "eslint": "^9.0.0",
    "kysely-codegen": "^0.18.0",
    "testcontainers": "^10.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.0.0"
  }
}
```

### Step 2: `pnpm install`

```bash
pnpm install
```

### Step 3: Modify `apps/server/src/env.ts`

Replace the file with:

```ts
import { z } from 'zod'

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().url(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  // ARGUS_MODE: parsed AND enforced as of M4 — `local` skips auth (auto-default-user);
  // `multi-tenant` requires real cookie/token auth on every request.
  ARGUS_MODE: z.enum(['local', 'multi-tenant']).default('local'),
  // JWT secret used to sign cookie sessions. Must be at least 32 chars in
  // multi-tenant mode; ignored content-wise in local mode but still required to
  // be defined so the schema stays uniform.
  JWT_SECRET: z.string().min(32).default('local-dev-secret-not-for-production-x'),
  COOKIE_NAME: z.string().default('argus_session'),
})

export type Env = z.infer<typeof envSchema>

export function loadEnv(env: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(env)
}
```

### Step 4: Write `apps/server/test/auth/password.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from '../../src/modules/auth/password.js'

describe('password helpers', () => {
  it('hashPassword returns a non-empty bcrypt-shaped string', async () => {
    const hash = await hashPassword('hunter2')
    expect(hash).toMatch(/^\$2[aby]\$\d{2}\$/)
  })

  it('verifyPassword returns true for the correct password', async () => {
    const hash = await hashPassword('hunter2')
    expect(await verifyPassword('hunter2', hash)).toBe(true)
  })

  it('verifyPassword returns false for the wrong password', async () => {
    const hash = await hashPassword('hunter2')
    expect(await verifyPassword('wrong', hash)).toBe(false)
  })

  it('verifyPassword returns false for the local-user sentinel hash', async () => {
    expect(await verifyPassword('anything', '$local$')).toBe(false)
  })
})
```

### Step 5: Run test, confirm FAIL

```bash
pnpm --filter @argus/server test
```

Expected: FAIL — `Cannot find module '.../auth/password.js'`.

### Step 6: Create `apps/server/src/modules/auth/password.ts`

```ts
import bcrypt from 'bcryptjs'

const ROUNDS = 10 // 10 ≈ 100ms on a modern CPU; balance for registration UX

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, ROUNDS)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  // bcrypt.compare throws on malformed hashes; the sentinel `$local$` we set
  // for the default-user row falls in that category. Treat any throw as "no".
  try {
    return await bcrypt.compare(password, hash)
  } catch {
    return false
  }
}
```

### Step 7: Run test, confirm PASS

```bash
pnpm --filter @argus/server test
```

Expected: PASS — 4 new password tests + 27 existing = 31 server tests (assuming M3 baseline is 27 + 4 password = 31; actual baseline 31 was from the M3 close-out so total is 31 + 4 = 35).

> NOTE: actual baseline test count at the start of M4 is 31 (per M3 acceptance). After this task, expect 35.

### Step 8: Write `apps/server/test/auth/jwt.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { signJwt, verifyJwt } from '../../src/modules/auth/jwt.js'

const SECRET = 'test-secret-xxxxxxxxxxxxxxxxxxxxxxxxxxxx'

describe('jwt helpers', () => {
  it('signJwt + verifyJwt round-trip returns the original payload', () => {
    const token = signJwt({ userId: 'u1' }, SECRET, 3600)
    expect(verifyJwt(token, SECRET)).toEqual(expect.objectContaining({ userId: 'u1' }))
  })

  it('verifyJwt returns null for an invalid signature', () => {
    const token = signJwt({ userId: 'u1' }, SECRET, 3600)
    expect(verifyJwt(token + 'tamper', SECRET)).toBeNull()
  })

  it('verifyJwt returns null for a token signed with a different secret', () => {
    const token = signJwt({ userId: 'u1' }, SECRET, 3600)
    expect(verifyJwt(token, 'other-secret-xxxxxxxxxxxxxxxxxxxxxxxxxx')).toBeNull()
  })

  it('verifyJwt returns null when token is expired', () => {
    const token = signJwt({ userId: 'u1' }, SECRET, -1) // already expired
    expect(verifyJwt(token, SECRET)).toBeNull()
  })
})
```

### Step 9: Create `apps/server/src/modules/auth/jwt.ts`

```ts
import jwt from 'jsonwebtoken'

export interface JwtPayload {
  userId: string
}

export function signJwt(payload: JwtPayload, secret: string, expiresInSeconds: number): string {
  return jwt.sign(payload, secret, { algorithm: 'HS256', expiresIn: expiresInSeconds })
}

export function verifyJwt(token: string, secret: string): JwtPayload | null {
  try {
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] })
    if (typeof decoded !== 'object' || decoded === null) return null
    const { userId } = decoded as { userId?: unknown }
    if (typeof userId !== 'string') return null
    return { userId }
  } catch {
    return null
  }
}
```

### Step 10: Run tests, confirm 4 more PASS

```bash
pnpm --filter @argus/server test
```

Expected: 39 total (31 + 4 password + 4 jwt).

### Step 11: Commit

```bash
git add apps/server
git commit -m "feat(server): add bcryptjs + jsonwebtoken + auth helpers (password + jwt)"
```

---

## Task 3: User DAO + auth types + auth middleware

**Files:**

- Create: `apps/server/src/modules/auth/types.ts`
- Create: `apps/server/src/modules/auth/dao.ts`
- Create: `apps/server/src/modules/auth/middleware.ts`
- Create: `apps/server/src/modules/auth/index.ts`
- Create: `apps/server/test/auth/middleware.test.ts`

### Step 1: Create `apps/server/src/modules/auth/types.ts`

```ts
export interface AuthUser {
  id: string
  email: string
  orgId: string
}

export interface AuthContext {
  user: AuthUser
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext
  }
}
```

### Step 2: Create `apps/server/src/modules/auth/dao.ts`

```ts
import type { Kysely } from 'kysely'
import type { DB } from '../../db/schema.js'
import { DEFAULT_USER_ID, DEFAULT_USER_EMAIL, DEFAULT_ORG_ID } from '../../constants.js'

export interface CreateUserInput {
  email: string
  passwordHash: string
  orgName: string
}

export interface UserRecord {
  id: string
  email: string
  passwordHash: string
  orgId: string
}

function emailLocalPart(email: string): string {
  const at = email.indexOf('@')
  return at > 0 ? email.slice(0, at) : email
}

export async function createUser(db: Kysely<DB>, input: CreateUserInput): Promise<UserRecord> {
  return db.transaction().execute(async (trx) => {
    const user = await trx
      .insertInto('users')
      .values({ email: input.email, password_hash: input.passwordHash })
      .returning(['id', 'email', 'password_hash'])
      .executeTakeFirstOrThrow()
    const org = await trx
      .insertInto('orgs')
      .values({
        id: crypto.randomUUID(),
        name: input.orgName || `${emailLocalPart(input.email)}'s workspace`,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow()
    await trx
      .insertInto('org_members')
      .values({ user_id: user.id, org_id: org.id, role: 'owner' })
      .execute()
    return { id: user.id, email: user.email, passwordHash: user.password_hash, orgId: org.id }
  })
}

export async function findUserByEmail(db: Kysely<DB>, email: string): Promise<UserRecord | null> {
  const row = await db
    .selectFrom('users as u')
    .innerJoin('org_members as m', 'm.user_id', 'u.id')
    .where('u.email', '=', email)
    .select([
      'u.id as id',
      'u.email as email',
      'u.password_hash as passwordHash',
      'm.org_id as orgId',
    ])
    .executeTakeFirst()
  return row ?? null
}

export async function findUserById(db: Kysely<DB>, userId: string): Promise<UserRecord | null> {
  const row = await db
    .selectFrom('users as u')
    .innerJoin('org_members as m', 'm.user_id', 'u.id')
    .where('u.id', '=', userId)
    .select([
      'u.id as id',
      'u.email as email',
      'u.password_hash as passwordHash',
      'm.org_id as orgId',
    ])
    .executeTakeFirst()
  return row ?? null
}

export async function getLocalDefaultUser(db: Kysely<DB>): Promise<UserRecord> {
  // Seeded by migration 0002. If missing (e.g., db wiped without re-migrating)
  // we return a stub to keep local mode usable; queries will then fail at the
  // first DB-touching point with a clear error.
  const found = await findUserById(db, DEFAULT_USER_ID)
  if (found) return found
  return {
    id: DEFAULT_USER_ID,
    email: DEFAULT_USER_EMAIL,
    passwordHash: '$local$',
    orgId: DEFAULT_ORG_ID,
  }
}
```

### Step 3: Write `apps/server/test/auth/middleware.test.ts`

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import { createTestDb, truncateAll } from '../helpers/db.js'
import { resolveAuthContext } from '../../src/modules/auth/middleware.js'
import { createUser } from '../../src/modules/auth/dao.js'
import { signJwt } from '../../src/modules/auth/jwt.js'
import { hashPassword } from '../../src/modules/auth/password.js'

const SECRET = 'test-secret-xxxxxxxxxxxxxxxxxxxxxxxxxxxx'
const COOKIE = 'argus_session'

describe('resolveAuthContext middleware', () => {
  const db = createTestDb()

  beforeEach(async () => {
    await truncateAll(db)
  })

  afterAll(async () => {
    await db.destroy()
  })

  async function makeApp(mode: 'local' | 'multi-tenant') {
    const app = Fastify()
    await app.register(cookie)
    app.addHook(
      'preHandler',
      resolveAuthContext({ db, mode, cookieName: COOKIE, jwtSecret: SECRET }),
    )
    app.get('/who', async (req) => req.auth?.user ?? null)
    return app
  }

  it('local mode authenticates every request as the default user', async () => {
    const app = await makeApp('local')
    const res = await app.inject({ method: 'GET', url: '/who' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      email: 'local@argus.dev',
      orgId: '00000000-0000-0000-0000-000000000000',
    })
    await app.close()
  })

  it('multi-tenant mode returns 401 without a cookie', async () => {
    const app = await makeApp('multi-tenant')
    const res = await app.inject({ method: 'GET', url: '/who' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('multi-tenant mode resolves a valid cookie to the user', async () => {
    const user = await createUser(db, {
      email: 'alice@example.com',
      passwordHash: await hashPassword('pw'),
      orgName: 'Alice workspace',
    })
    const token = signJwt({ userId: user.id }, SECRET, 3600)
    const app = await makeApp('multi-tenant')
    const res = await app.inject({
      method: 'GET',
      url: '/who',
      cookies: { [COOKIE]: token },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ email: 'alice@example.com', orgId: user.orgId })
    await app.close()
  })

  it('multi-tenant mode returns 401 for a tampered cookie', async () => {
    const app = await makeApp('multi-tenant')
    const res = await app.inject({
      method: 'GET',
      url: '/who',
      cookies: { [COOKIE]: 'not.a.real.jwt' },
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })
})
```

### Step 4: Run test, confirm FAIL

```bash
pnpm --filter @argus/server test
```

Expected: FAIL — `Cannot find module '.../auth/middleware.js'`.

### Step 5: Create `apps/server/src/modules/auth/middleware.ts`

```ts
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify'
import type { Kysely } from 'kysely'
import type { DB } from '../../db/schema.js'
import { findUserById, getLocalDefaultUser } from './dao.js'
import { verifyJwt } from './jwt.js'

export interface AuthMiddlewareDeps {
  db: Kysely<DB>
  mode: 'local' | 'multi-tenant'
  cookieName: string
  jwtSecret: string
}

export function resolveAuthContext(deps: AuthMiddlewareDeps): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (deps.mode === 'local') {
      const user = await getLocalDefaultUser(deps.db)
      request.auth = { user: { id: user.id, email: user.email, orgId: user.orgId } }
      return
    }

    const cookieValue = request.cookies?.[deps.cookieName]
    if (!cookieValue) {
      reply.code(401)
      throw new Error('unauthenticated')
    }

    const payload = verifyJwt(cookieValue, deps.jwtSecret)
    if (!payload) {
      reply.code(401)
      throw new Error('unauthenticated')
    }

    const user = await findUserById(deps.db, payload.userId)
    if (!user) {
      reply.code(401)
      throw new Error('unauthenticated')
    }

    request.auth = { user: { id: user.id, email: user.email, orgId: user.orgId } }
  }
}
```

### Step 6: Create `apps/server/src/modules/auth/index.ts`

```ts
export type { AuthContext, AuthUser } from './types.js'
export { hashPassword, verifyPassword } from './password.js'
export { signJwt, verifyJwt } from './jwt.js'
export { createUser, findUserByEmail, findUserById, getLocalDefaultUser } from './dao.js'
export type { CreateUserInput, UserRecord } from './dao.js'
export { resolveAuthContext } from './middleware.js'
export type { AuthMiddlewareDeps } from './middleware.js'
```

### Step 7: Run tests

```bash
pnpm --filter @argus/server test
```

Expected: PASS — 4 new middleware tests + 39 from before = 43 total.

### Step 8: Commit

```bash
git add apps/server/src/modules/auth apps/server/test/auth/middleware.test.ts
git commit -m "feat(server): user dao + auth context + cookie middleware (local + multi-tenant modes)"
```

---

## Task 4: Auth routes (register / login / logout / me) + tests

**Files:**

- Create: `apps/server/src/modules/auth/routes.ts`
- Create: `apps/server/test/auth/routes.test.ts`
- Modify: `apps/server/src/modules/auth/index.ts` (add `authRoutes` export)

### Step 1: Write `apps/server/test/auth/routes.test.ts`

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import { createTestDb, truncateAll } from '../helpers/db.js'
import { authRoutes } from '../../src/modules/auth/routes.js'

const SECRET = 'test-secret-xxxxxxxxxxxxxxxxxxxxxxxxxxxx'
const COOKIE = 'argus_session'

describe('auth routes', () => {
  const db = createTestDb()

  beforeEach(async () => {
    await truncateAll(db)
  })

  afterAll(async () => {
    await db.destroy()
  })

  async function makeApp() {
    const app = Fastify()
    await app.register(cookie)
    await app.register(authRoutes, {
      db,
      cookieName: COOKIE,
      jwtSecret: SECRET,
      cookieSecure: false,
      sessionTtlSeconds: 3600,
    })
    return app
  }

  it('POST /auth/register creates a user, returns the user, sets cookie', async () => {
    const app = await makeApp()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'alice@example.com', password: 'pw-at-least-8' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { user: { id: string; email: string; orgId: string } }
    expect(body.user.email).toBe('alice@example.com')
    expect(body.user.orgId).toMatch(/^[0-9a-f-]{36}$/)
    const setCookie = res.headers['set-cookie']
    expect(setCookie).toBeDefined()
    expect(String(setCookie)).toContain(`${COOKIE}=`)
    await app.close()
  })

  it('POST /auth/register returns 409 when email already exists', async () => {
    const app = await makeApp()
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'dup@example.com', password: 'pw-at-least-8' },
    })
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'dup@example.com', password: 'pw-at-least-8' },
    })
    expect(res.statusCode).toBe(409)
    await app.close()
  })

  it('POST /auth/login with correct credentials returns 200 + sets cookie', async () => {
    const app = await makeApp()
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'bob@example.com', password: 'pw-at-least-8' },
    })
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'bob@example.com', password: 'pw-at-least-8' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ user: { email: 'bob@example.com' } })
    await app.close()
  })

  it('POST /auth/login returns 401 with wrong password', async () => {
    const app = await makeApp()
    await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'c@example.com', password: 'pw-at-least-8' },
    })
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'c@example.com', password: 'wrong-pw-here' },
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('POST /auth/logout clears the cookie', async () => {
    const app = await makeApp()
    const res = await app.inject({ method: 'POST', url: '/auth/logout' })
    expect(res.statusCode).toBe(200)
    const setCookie = String(res.headers['set-cookie'])
    expect(setCookie).toContain(`${COOKIE}=`)
    expect(setCookie.toLowerCase()).toContain('max-age=0')
    await app.close()
  })
})
```

### Step 2: Run test, confirm FAIL

```bash
pnpm --filter @argus/server test
```

Expected: FAIL — `Cannot find module '.../auth/routes.js'`.

### Step 3: Create `apps/server/src/modules/auth/routes.ts`

```ts
import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import type { Kysely } from 'kysely'
import { z } from 'zod'
import type { DB } from '../../db/schema.js'
import { createUser, findUserByEmail } from './dao.js'
import { hashPassword, verifyPassword } from './password.js'
import { signJwt } from './jwt.js'

export interface AuthRoutesDeps {
  db: Kysely<DB>
  cookieName: string
  jwtSecret: string
  cookieSecure: boolean
  sessionTtlSeconds: number
}

const registerBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
})

const loginBodySchema = registerBodySchema

function setSessionCookie(
  reply: import('fastify').FastifyReply,
  deps: AuthRoutesDeps,
  userId: string,
) {
  const token = signJwt({ userId }, deps.jwtSecret, deps.sessionTtlSeconds)
  reply.setCookie(deps.cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: deps.cookieSecure,
    path: '/',
    maxAge: deps.sessionTtlSeconds,
  })
}

function clearSessionCookie(reply: import('fastify').FastifyReply, deps: AuthRoutesDeps) {
  reply.setCookie(deps.cookieName, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: deps.cookieSecure,
    path: '/',
    maxAge: 0,
  })
}

export const authRoutes: FastifyPluginAsync<AuthRoutesDeps> = async (
  app: FastifyInstance,
  deps,
) => {
  app.post('/auth/register', async (request, reply) => {
    const parsed = registerBodySchema.safeParse(request.body)
    if (!parsed.success) {
      reply.code(400)
      return { error: 'invalid_input', issues: parsed.error.issues }
    }
    const { email, password } = parsed.data

    const existing = await findUserByEmail(deps.db, email)
    if (existing) {
      reply.code(409)
      return { error: 'email_already_registered' }
    }

    const passwordHash = await hashPassword(password)
    const record = await createUser(deps.db, { email, passwordHash, orgName: '' })
    setSessionCookie(reply, deps, record.id)
    return { user: { id: record.id, email: record.email, orgId: record.orgId } }
  })

  app.post('/auth/login', async (request, reply) => {
    const parsed = loginBodySchema.safeParse(request.body)
    if (!parsed.success) {
      reply.code(400)
      return { error: 'invalid_input', issues: parsed.error.issues }
    }
    const { email, password } = parsed.data

    const record = await findUserByEmail(deps.db, email)
    if (!record) {
      reply.code(401)
      return { error: 'invalid_credentials' }
    }
    const ok = await verifyPassword(password, record.passwordHash)
    if (!ok) {
      reply.code(401)
      return { error: 'invalid_credentials' }
    }

    setSessionCookie(reply, deps, record.id)
    return { user: { id: record.id, email: record.email, orgId: record.orgId } }
  })

  app.post('/auth/logout', async (_request, reply) => {
    clearSessionCookie(reply, deps)
    return { ok: true }
  })

  app.get('/auth/me', async (request, reply) => {
    if (!request.auth) {
      reply.code(401)
      return { error: 'unauthenticated' }
    }
    return { user: request.auth.user }
  })
}
```

### Step 4: Update `apps/server/src/modules/auth/index.ts`

```ts
export type { AuthContext, AuthUser } from './types.js'
export { hashPassword, verifyPassword } from './password.js'
export { signJwt, verifyJwt } from './jwt.js'
export { createUser, findUserByEmail, findUserById, getLocalDefaultUser } from './dao.js'
export type { CreateUserInput, UserRecord } from './dao.js'
export { resolveAuthContext } from './middleware.js'
export type { AuthMiddlewareDeps } from './middleware.js'
export { authRoutes } from './routes.js'
export type { AuthRoutesDeps } from './routes.js'
```

### Step 5: Run tests, confirm PASS

```bash
pnpm --filter @argus/server test
```

Expected: PASS — 5 new route tests + 43 = 48 total.

### Step 6: Commit

```bash
git add apps/server/src/modules/auth apps/server/test/auth/routes.test.ts
git commit -m "feat(server): auth routes (register / login / logout / me)"
```

---

## Task 5: Token helpers + Token DAO + tests

**Files:**

- Create: `apps/server/src/modules/tokens/helpers.ts`
- Create: `apps/server/src/modules/tokens/dao.ts`
- Create: `apps/server/src/modules/tokens/index.ts`
- Create: `apps/server/test/tokens/helpers.test.ts`

### Step 1: Write `apps/server/test/tokens/helpers.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import {
  generateToken,
  hashToken,
  parseAuthHeader,
  prefixForDisplay,
} from '../../src/modules/tokens/helpers.js'

describe('token helpers', () => {
  it('generateToken produces an argus_-prefixed 38-char string', () => {
    const t = generateToken()
    expect(t).toMatch(/^argus_[0-9a-f]{32}$/)
    expect(t).toHaveLength(38)
  })

  it('hashToken returns a 64-char hex sha256', () => {
    const t = 'argus_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const h = hashToken(t)
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(hashToken(t)).toBe(h)
  })

  it('prefixForDisplay returns the first 12 chars', () => {
    expect(prefixForDisplay('argus_abcdef1234567890')).toBe('argus_abcdef')
  })

  it('parseAuthHeader extracts a bearer token', () => {
    expect(parseAuthHeader('Bearer argus_xxx')).toBe('argus_xxx')
    expect(parseAuthHeader('bearer argus_xxx')).toBe('argus_xxx')
    expect(parseAuthHeader('Token argus_xxx')).toBeNull()
    expect(parseAuthHeader(undefined)).toBeNull()
  })
})
```

### Step 2: Run, confirm FAIL

```bash
pnpm --filter @argus/server test
```

Expected: FAIL — module not found.

### Step 3: Create `apps/server/src/modules/tokens/helpers.ts`

```ts
import { createHash, randomBytes } from 'node:crypto'

export function generateToken(): string {
  return `argus_${randomBytes(16).toString('hex')}`
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function prefixForDisplay(token: string): string {
  return token.slice(0, 12)
}

export function parseAuthHeader(header: string | undefined): string | null {
  if (!header) return null
  const m = /^Bearer\s+(.+)$/i.exec(header)
  return m ? m[1]!.trim() : null
}
```

### Step 4: Create `apps/server/src/modules/tokens/dao.ts`

```ts
import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import type { DB } from '../../db/schema.js'
import { generateToken, hashToken, prefixForDisplay } from './helpers.js'

export interface CreatedTokenRecord {
  id: string
  projectId: string
  name: string
  prefix: string
  createdAt: Date
  /** The full token, returned ONCE at creation time. Not stored anywhere after. */
  token: string
}

export interface StoredTokenRecord {
  id: string
  projectId: string
  projectName: string
  name: string
  prefix: string
  createdAt: Date
  revokedAt: Date | null
}

export interface ResolvedTokenContext {
  tokenId: string
  orgId: string
  projectId: string
  projectName: string
}

export async function createTokenForProject(
  db: Kysely<DB>,
  opts: { orgId: string; projectName: string; tokenName: string },
): Promise<CreatedTokenRecord> {
  return db.transaction().execute(async (trx) => {
    // Upsert project (matches the pattern PgStorage uses for ingest).
    const existing = await trx
      .selectFrom('projects')
      .where('org_id', '=', opts.orgId)
      .where('name', '=', opts.projectName)
      .select('id')
      .executeTakeFirst()
    const projectId = existing
      ? existing.id
      : (
          await trx
            .insertInto('projects')
            .values({ org_id: opts.orgId, name: opts.projectName })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id

    const token = generateToken()
    const inserted = await trx
      .insertInto('ingest_tokens')
      .values({
        project_id: projectId,
        name: opts.tokenName,
        token_prefix: prefixForDisplay(token),
        token_hash: hashToken(token),
      })
      .returning(['id', 'name', 'token_prefix', 'created_at'])
      .executeTakeFirstOrThrow()

    return {
      id: inserted.id,
      projectId,
      name: inserted.name,
      prefix: inserted.token_prefix,
      createdAt: new Date(inserted.created_at as unknown as string),
      token,
    }
  })
}

export async function listTokensForOrg(
  db: Kysely<DB>,
  orgId: string,
): Promise<StoredTokenRecord[]> {
  const rows = await db
    .selectFrom('ingest_tokens as t')
    .innerJoin('projects as p', 'p.id', 't.project_id')
    .where('p.org_id', '=', orgId)
    .select([
      't.id as id',
      't.project_id as projectId',
      'p.name as projectName',
      't.name as name',
      't.token_prefix as prefix',
      't.created_at as createdAt',
      't.revoked_at as revokedAt',
    ])
    .orderBy('t.created_at', 'desc')
    .execute()

  return rows.map((r) => ({
    ...r,
    createdAt: new Date(r.createdAt as unknown as string),
    revokedAt: r.revokedAt ? new Date(r.revokedAt as unknown as string) : null,
  }))
}

export async function revokeToken(
  db: Kysely<DB>,
  opts: { orgId: string; tokenId: string },
): Promise<boolean> {
  // Verify the token belongs to the org before revoking.
  const owned = await db
    .selectFrom('ingest_tokens as t')
    .innerJoin('projects as p', 'p.id', 't.project_id')
    .where('t.id', '=', opts.tokenId)
    .where('p.org_id', '=', opts.orgId)
    .select('t.id')
    .executeTakeFirst()
  if (!owned) return false

  await db
    .updateTable('ingest_tokens')
    .set({ revoked_at: sql`now()` })
    .where('id', '=', opts.tokenId)
    .execute()
  return true
}

export async function resolveTokenContext(
  db: Kysely<DB>,
  token: string,
): Promise<ResolvedTokenContext | null> {
  const hash = hashToken(token)
  const row = await db
    .selectFrom('ingest_tokens as t')
    .innerJoin('projects as p', 'p.id', 't.project_id')
    .where('t.token_hash', '=', hash)
    .where('t.revoked_at', 'is', null)
    .select(['t.id as tokenId', 'p.id as projectId', 'p.name as projectName', 'p.org_id as orgId'])
    .executeTakeFirst()
  return row ?? null
}
```

### Step 5: Create `apps/server/src/modules/tokens/index.ts`

```ts
export { generateToken, hashToken, parseAuthHeader, prefixForDisplay } from './helpers.js'
export { createTokenForProject, listTokensForOrg, revokeToken, resolveTokenContext } from './dao.js'
export type { CreatedTokenRecord, StoredTokenRecord, ResolvedTokenContext } from './dao.js'
```

### Step 6: Run tests

```bash
pnpm --filter @argus/server test
```

Expected: PASS — 4 new helper tests + 48 = 52 total.

### Step 7: Commit

```bash
git add apps/server/src/modules/tokens apps/server/test/tokens/helpers.test.ts
git commit -m "feat(server): ingest token helpers + dao (generate, hash, list, revoke, resolve)"
```

---

## Task 6: Token middleware (bearer for ingest) + tests

**Files:**

- Create: `apps/server/src/modules/tokens/middleware.ts`
- Create: `apps/server/test/tokens/middleware.test.ts`
- Modify: `apps/server/src/modules/tokens/index.ts`

### Step 1: Create `apps/server/src/modules/tokens/middleware.ts`

```ts
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify'
import type { Kysely } from 'kysely'
import type { DB } from '../../db/schema.js'
import { DEFAULT_ORG_ID } from '../../constants.js'
import { parseAuthHeader } from './helpers.js'
import { resolveTokenContext, type ResolvedTokenContext } from './dao.js'

export interface IngestContext {
  orgId: string
  /** Optional — when provided by a token, ingest can constrain project. */
  projectId?: string
  projectName?: string
}

declare module 'fastify' {
  interface FastifyRequest {
    ingest?: IngestContext
  }
}

export interface TokenMiddlewareDeps {
  db: Kysely<DB>
  mode: 'local' | 'multi-tenant'
}

export function resolveIngestContext(deps: TokenMiddlewareDeps): preHandlerHookHandler {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (deps.mode === 'local') {
      request.ingest = { orgId: DEFAULT_ORG_ID }
      return
    }

    const headerToken = parseAuthHeader(request.headers.authorization)
    if (!headerToken) {
      reply.code(401)
      throw new Error('missing_ingest_token')
    }

    const ctx = await resolveTokenContext(deps.db, headerToken)
    if (!ctx) {
      reply.code(401)
      throw new Error('invalid_ingest_token')
    }

    request.ingest = makeIngestContext(ctx)
  }
}

function makeIngestContext(ctx: ResolvedTokenContext): IngestContext {
  return { orgId: ctx.orgId, projectId: ctx.projectId, projectName: ctx.projectName }
}
```

### Step 2: Write `apps/server/test/tokens/middleware.test.ts`

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { createTestDb, truncateAll } from '../helpers/db.js'
import { resolveIngestContext } from '../../src/modules/tokens/middleware.js'
import { createTokenForProject } from '../../src/modules/tokens/dao.js'
import { createUser } from '../../src/modules/auth/dao.js'
import { hashPassword } from '../../src/modules/auth/password.js'

describe('resolveIngestContext middleware', () => {
  const db = createTestDb()

  beforeEach(async () => {
    await truncateAll(db)
  })

  afterAll(async () => {
    await db.destroy()
  })

  async function makeApp(mode: 'local' | 'multi-tenant') {
    const app = Fastify()
    app.addHook('preHandler', resolveIngestContext({ db, mode }))
    app.post('/in', async (req) => req.ingest ?? null)
    return app
  }

  it('local mode auto-assigns the default org', async () => {
    const app = await makeApp('local')
    const res = await app.inject({ method: 'POST', url: '/in' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ orgId: '00000000-0000-0000-0000-000000000000' })
    await app.close()
  })

  it('multi-tenant mode returns 401 without a token', async () => {
    const app = await makeApp('multi-tenant')
    const res = await app.inject({ method: 'POST', url: '/in' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('multi-tenant mode resolves a valid bearer token to its org/project', async () => {
    const user = await createUser(db, {
      email: 'tk@example.com',
      passwordHash: await hashPassword('pwpwpwpw'),
      orgName: 'Tk org',
    })
    const created = await createTokenForProject(db, {
      orgId: user.orgId,
      projectName: 'proj1',
      tokenName: 'first token',
    })

    const app = await makeApp('multi-tenant')
    const res = await app.inject({
      method: 'POST',
      url: '/in',
      headers: { authorization: `Bearer ${created.token}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      orgId: user.orgId,
      projectId: created.projectId,
      projectName: 'proj1',
    })
    await app.close()
  })

  it('multi-tenant mode returns 401 for a revoked or unknown token', async () => {
    const app = await makeApp('multi-tenant')
    const res = await app.inject({
      method: 'POST',
      url: '/in',
      headers: { authorization: 'Bearer argus_nope' },
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })
})
```

### Step 3: Update `apps/server/src/modules/tokens/index.ts`

```ts
export { generateToken, hashToken, parseAuthHeader, prefixForDisplay } from './helpers.js'
export { createTokenForProject, listTokensForOrg, revokeToken, resolveTokenContext } from './dao.js'
export type { CreatedTokenRecord, StoredTokenRecord, ResolvedTokenContext } from './dao.js'
export { resolveIngestContext } from './middleware.js'
export type { IngestContext, TokenMiddlewareDeps } from './middleware.js'
```

### Step 4: Run tests, confirm PASS

```bash
pnpm --filter @argus/server test
```

Expected: 4 new + 52 = 56 total.

### Step 5: Commit

```bash
git add apps/server/src/modules/tokens apps/server/test/tokens/middleware.test.ts
git commit -m "feat(server): ingest token bearer middleware (local + multi-tenant)"
```

---

## Task 7: Token + project management routes

**Files:**

- Create: `apps/server/src/modules/tokens/routes.ts`
- Create: `apps/server/test/tokens/routes.test.ts`
- Modify: `apps/server/src/modules/tokens/index.ts`

### Step 1: Create `apps/server/src/modules/tokens/routes.ts`

```ts
import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import type { Kysely } from 'kysely'
import { z } from 'zod'
import type { DB } from '../../db/schema.js'
import { createTokenForProject, listTokensForOrg, revokeToken } from './dao.js'

export interface TokenRoutesDeps {
  db: Kysely<DB>
}

const createTokenBodySchema = z.object({
  projectName: z.string().min(1).max(255),
  tokenName: z.string().min(1).max(255),
})

export const tokenManagementRoutes: FastifyPluginAsync<TokenRoutesDeps> = async (
  app: FastifyInstance,
  deps,
) => {
  // GET /api/tokens — list tokens for the authenticated org
  app.get('/api/tokens', async (request, reply) => {
    if (!request.auth) {
      reply.code(401)
      return { error: 'unauthenticated' }
    }
    const tokens = await listTokensForOrg(deps.db, request.auth.user.orgId)
    return {
      tokens: tokens.map((t) => ({
        id: t.id,
        projectId: t.projectId,
        projectName: t.projectName,
        name: t.name,
        prefix: t.prefix,
        createdAt: t.createdAt.toISOString(),
        revokedAt: t.revokedAt ? t.revokedAt.toISOString() : null,
      })),
    }
  })

  // POST /api/tokens — create a token (also upserts the project)
  app.post('/api/tokens', async (request, reply) => {
    if (!request.auth) {
      reply.code(401)
      return { error: 'unauthenticated' }
    }
    const parsed = createTokenBodySchema.safeParse(request.body)
    if (!parsed.success) {
      reply.code(400)
      return { error: 'invalid_input', issues: parsed.error.issues }
    }
    const created = await createTokenForProject(deps.db, {
      orgId: request.auth.user.orgId,
      projectName: parsed.data.projectName,
      tokenName: parsed.data.tokenName,
    })
    return {
      token: created.token,
      record: {
        id: created.id,
        projectId: created.projectId,
        name: created.name,
        prefix: created.prefix,
        createdAt: created.createdAt.toISOString(),
      },
    }
  })

  // DELETE /api/tokens/:id — revoke
  app.delete<{ Params: { id: string } }>('/api/tokens/:id', async (request, reply) => {
    if (!request.auth) {
      reply.code(401)
      return { error: 'unauthenticated' }
    }
    const ok = await revokeToken(deps.db, {
      orgId: request.auth.user.orgId,
      tokenId: request.params.id,
    })
    if (!ok) {
      reply.code(404)
      return { error: 'not_found' }
    }
    return { ok: true }
  })
}
```

### Step 2: Update `apps/server/src/modules/tokens/index.ts`

```ts
export { generateToken, hashToken, parseAuthHeader, prefixForDisplay } from './helpers.js'
export { createTokenForProject, listTokensForOrg, revokeToken, resolveTokenContext } from './dao.js'
export type { CreatedTokenRecord, StoredTokenRecord, ResolvedTokenContext } from './dao.js'
export { resolveIngestContext } from './middleware.js'
export type { IngestContext, TokenMiddlewareDeps } from './middleware.js'
export { tokenManagementRoutes } from './routes.js'
export type { TokenRoutesDeps } from './routes.js'
```

### Step 3: Write `apps/server/test/tokens/routes.test.ts`

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { createTestDb, truncateAll } from '../helpers/db.js'
import { tokenManagementRoutes } from '../../src/modules/tokens/routes.js'
import { createUser } from '../../src/modules/auth/dao.js'
import { hashPassword } from '../../src/modules/auth/password.js'

describe('token management routes', () => {
  const db = createTestDb()

  beforeEach(async () => {
    await truncateAll(db)
  })

  afterAll(async () => {
    await db.destroy()
  })

  async function makeApp(orgId: string | null) {
    const app = Fastify()
    app.addHook('preHandler', async (req) => {
      if (orgId) req.auth = { user: { id: 'u', email: 'e', orgId } }
    })
    await app.register(tokenManagementRoutes, { db })
    return app
  }

  it('GET /api/tokens returns 401 without auth', async () => {
    const app = await makeApp(null)
    const res = await app.inject({ method: 'GET', url: '/api/tokens' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('POST /api/tokens creates a token + returns it once', async () => {
    const u = await createUser(db, {
      email: 'a@example.com',
      passwordHash: await hashPassword('pwpwpwpw'),
      orgName: 'org',
    })
    const app = await makeApp(u.orgId)
    const res = await app.inject({
      method: 'POST',
      url: '/api/tokens',
      payload: { projectName: 'p1', tokenName: 'first' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { token: string; record: { prefix: string } }
    expect(body.token).toMatch(/^argus_[0-9a-f]{32}$/)
    expect(body.record.prefix).toBe(body.token.slice(0, 12))
    await app.close()
  })

  it('GET /api/tokens lists tokens after creation', async () => {
    const u = await createUser(db, {
      email: 'b@example.com',
      passwordHash: await hashPassword('pwpwpwpw'),
      orgName: 'org',
    })
    const app = await makeApp(u.orgId)
    await app.inject({
      method: 'POST',
      url: '/api/tokens',
      payload: { projectName: 'p1', tokenName: 'first' },
    })
    const res = await app.inject({ method: 'GET', url: '/api/tokens' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { tokens: Array<{ name: string }> }
    expect(body.tokens).toHaveLength(1)
    expect(body.tokens[0]?.name).toBe('first')
    await app.close()
  })

  it('DELETE /api/tokens/:id revokes a token', async () => {
    const u = await createUser(db, {
      email: 'c@example.com',
      passwordHash: await hashPassword('pwpwpwpw'),
      orgName: 'org',
    })
    const app = await makeApp(u.orgId)
    const created = (await app
      .inject({
        method: 'POST',
        url: '/api/tokens',
        payload: { projectName: 'p1', tokenName: 'first' },
      })
      .then((r) => r.json())) as { record: { id: string } }
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/tokens/${created.record.id}`,
    })
    expect(res.statusCode).toBe(200)

    const listRes = await app.inject({ method: 'GET', url: '/api/tokens' })
    const list = listRes.json() as { tokens: Array<{ revokedAt: string | null }> }
    expect(list.tokens[0]?.revokedAt).not.toBeNull()
    await app.close()
  })

  it('DELETE returns 404 for a token belonging to a different org', async () => {
    const a = await createUser(db, {
      email: 'x@example.com',
      passwordHash: await hashPassword('pwpwpwpw'),
      orgName: 'org-a',
    })
    const b = await createUser(db, {
      email: 'y@example.com',
      passwordHash: await hashPassword('pwpwpwpw'),
      orgName: 'org-b',
    })
    const appA = await makeApp(a.orgId)
    const tokenRes = await appA.inject({
      method: 'POST',
      url: '/api/tokens',
      payload: { projectName: 'p1', tokenName: 't' },
    })
    const aTokenId = (tokenRes.json() as { record: { id: string } }).record.id
    await appA.close()

    const appB = await makeApp(b.orgId)
    const res = await appB.inject({ method: 'DELETE', url: `/api/tokens/${aTokenId}` })
    expect(res.statusCode).toBe(404)
    await appB.close()
  })
})
```

### Step 4: Run tests, confirm PASS

```bash
pnpm --filter @argus/server test
```

Expected: 5 new + 56 = 61 total.

### Step 5: Commit

```bash
git add apps/server/src/modules/tokens apps/server/test/tokens/routes.test.ts
git commit -m "feat(server): token management routes (list / create / revoke) + cross-org guard"
```

---

## Task 8: Wire auth into existing routes + cross-org isolation test + server.ts

**Files:**

- Modify: `apps/server/src/modules/api/routes.ts`
- Modify: `apps/server/src/modules/ingest/routes.ts`
- Modify: `apps/server/src/modules/pusher/routes.ts`
- Modify: `apps/server/src/server.ts`
- Modify: `apps/server/test/ingest/routes.test.ts` (factory now injects auth/ingest deps; tests already use real PgStorage)
- Modify: `apps/server/test/api/routes.test.ts` (factory now injects a stub auth preHandler)
- Modify: `apps/server/test/pusher/sse-integration.test.ts` (factory injects auth stub for SSE; ingest path uses bearer token)
- Create: `apps/server/test/isolation/cross-org.test.ts`

### Step 1: Replace `apps/server/src/modules/api/routes.ts`

```ts
import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import type { StorageBackend } from '../storage/types.js'
import { storedStepToApi } from './mappers.js'

export interface ApiRoutesDeps {
  storage: StorageBackend
}

export const apiRoutes: FastifyPluginAsync<ApiRoutesDeps> = async (app: FastifyInstance, deps) => {
  app.get('/api/sessions', async (request, reply) => {
    if (!request.auth) {
      reply.code(401)
      return { error: 'unauthenticated' }
    }
    const query = request.query as { limit?: string }
    const limit = query.limit ? Math.min(200, Math.max(1, parseInt(query.limit, 10))) : 50
    const sessions = await deps.storage.listSessions({
      orgId: request.auth.user.orgId,
      limit,
    })
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
    if (!request.auth) {
      reply.code(401)
      return { error: 'unauthenticated' }
    }
    const { sessionId } = request.params as { sessionId: string }
    const detail = await deps.storage.getSession({
      orgId: request.auth.user.orgId,
      sessionId,
    })
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

### Step 2: Replace `apps/server/src/modules/ingest/routes.ts`

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
    const ingest = request.ingest
    if (!ingest) {
      reply.code(401)
      return { error: 'unauthenticated' }
    }

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
      // Stamp orgId from the request context. If the token also pinned a
      // specific project, force the project name to match — clients can't write
      // to projects outside their token's scope.
      const overridden = {
        ...trace,
        orgId: ingest.orgId,
        projectName: ingest.projectName ?? trace.projectName,
      }
      const result = await deps.storage.writeTrace(overridden)
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

### Step 3: Replace `apps/server/src/modules/pusher/routes.ts`

Find the existing `pusherRoutes` and update the SSE handler to use `request.auth` for orgId instead of `DEFAULT_ORG_ID`. Replace the file with:

```ts
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from 'fastify'
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
      if (!request.auth) {
        reply.code(401)
        return { error: 'unauthenticated' }
      }
      const orgId = request.auth.user.orgId
      const { sessionId } = request.params
      const lastEventId = readLastEventId(request)

      // 404 guard: refuse to open a stream for a session that doesn't belong
      // to the requester's org. (Previously this leaked over SSE.)
      const detail = await deps.storage.getSession({ orgId, sessionId })
      if (!detail) {
        reply.code(404)
        return { error: 'not_found' }
      }

      reply.hijack()
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      })

      if (lastEventId) {
        const idx = detail.steps.findIndex((s) => s.id === lastEventId)
        const replay = idx >= 0 ? detail.steps.slice(idx + 1) : []
        for (const stored of replay) {
          const step = storedStepToApi(stored)
          reply.raw.write(formatSseEvent(step.id, { type: 'step', step }))
        }
      }

      reply.raw.write(formatSseEvent(undefined, { type: 'connected' }))

      const handler: MessageHandler = (payload) => {
        const step = payload as Step
        try {
          reply.raw.write(formatSseEvent(step.id, { type: 'step', step }))
        } catch {
          // socket closed; cleanup runs via 'close' below
        }
      }
      const unsubscribe = deps.bus.subscribe(`session:${sessionId}`, handler)

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
    },
  )
}

function readLastEventId(req: FastifyRequest): string | undefined {
  const fromHeader =
    req.headers['last-event-id'] ?? (req.headers as Record<string, string>)['Last-Event-ID']
  if (typeof fromHeader === 'string' && fromHeader.length > 0) return fromHeader
  const q = req.query as { lastEventId?: string } | undefined
  return q?.lastEventId
}
```

### Step 4: Replace `apps/server/src/server.ts`

```ts
import Fastify, { type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import type { Kysely } from 'kysely'
import type { DB } from './db/schema.js'
import { createKysely } from './db/kysely.js'
import { PgStorage } from './modules/storage/pg.js'
import { InProcMessageBus } from './modules/pubsub/index.js'
import type { MessageBus } from './modules/pubsub/types.js'
import { ingestRoutes } from './modules/ingest/index.js'
import { apiRoutes } from './modules/api/index.js'
import { pusherRoutes } from './modules/pusher/index.js'
import { authRoutes, resolveAuthContext, type AuthMiddlewareDeps } from './modules/auth/index.js'
import { resolveIngestContext, tokenManagementRoutes } from './modules/tokens/index.js'

export interface ServerOptions {
  databaseUrl: string
  logLevel?: string
  mode: 'local' | 'multi-tenant'
  jwtSecret: string
  cookieName: string
  cookieSecure?: boolean
  sessionTtlSeconds?: number
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

  await app.register(cookie)

  app.get('/healthz', async () => ({ status: 'ok' }))

  // Auth routes: always registered. In local mode the cookie isn't used but
  // registering routes lets the web app's AuthProvider hit /auth/me uniformly.
  await app.register(authRoutes, {
    db,
    cookieName: opts.cookieName,
    jwtSecret: opts.jwtSecret,
    cookieSecure: opts.cookieSecure ?? false,
    sessionTtlSeconds: opts.sessionTtlSeconds ?? 7 * 24 * 3600,
  })

  // Authenticated UI/query API + pusher SSE.
  const authDeps: AuthMiddlewareDeps = {
    db,
    mode: opts.mode,
    cookieName: opts.cookieName,
    jwtSecret: opts.jwtSecret,
  }
  await app.register(
    async (scope) => {
      scope.addHook('preHandler', resolveAuthContext(authDeps))
      await scope.register(apiRoutes, { storage })
      await scope.register(pusherRoutes, { storage, bus })
      await scope.register(tokenManagementRoutes, { db })
    },
    { prefix: '' },
  )

  // Ingest: bearer-token-protected in multi-tenant mode; open in local mode.
  await app.register(
    async (scope) => {
      scope.addHook('preHandler', resolveIngestContext({ db, mode: opts.mode }))
      await scope.register(ingestRoutes, { storage, bus })
    },
    { prefix: '' },
  )

  app.addHook('onClose', async () => {
    bus.removeAllSubscribers()
    await db.destroy()
  })

  return { app, db, bus }
}
```

### Step 5: Update `apps/server/src/main.ts`

```ts
import { loadEnv } from './env.js'
import { createServer } from './server.js'

async function main() {
  const env = loadEnv()
  const { app } = await createServer({
    databaseUrl: env.DATABASE_URL,
    logLevel: env.LOG_LEVEL,
    mode: env.ARGUS_MODE,
    jwtSecret: env.JWT_SECRET,
    cookieName: env.COOKIE_NAME,
  })

  await app.listen({ port: env.PORT, host: env.HOST })
  app.log.info(`Argus server listening on http://${env.HOST}:${env.PORT}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
```

### Step 6: Update existing tests to inject the auth/ingest preHandlers

**`apps/server/test/api/routes.test.ts`** — change `makeApp()`:

```ts
async function makeApp(orgId: string) {
  const app = Fastify()
  app.addHook('preHandler', async (req) => {
    req.auth = { user: { id: 'u', email: 'e', orgId } }
  })
  await app.register(apiRoutes, { storage })
  return app
}
```

Then update each call site that used the default `ORG` constant to pass it:

- The existing tests use `const ORG = '00000000-0000-0000-0000-000000000000'` and call `await makeApp()`. Change to `await makeApp(ORG)`. Other test assertions remain unchanged.

**`apps/server/test/ingest/routes.test.ts`** — change `makeApp()`:

```ts
async function makeApp() {
  const app = Fastify()
  const bus = new InProcMessageBus()
  app.addHook('preHandler', async (req) => {
    req.ingest = { orgId: '00000000-0000-0000-0000-000000000000' }
  })
  await app.register(ingestRoutes, { storage, bus })
  return app
}
```

**`apps/server/test/pusher/sse-integration.test.ts`** — change the test app setup:

After `app = Fastify()` and before registering routes, add:

```ts
app.addHook('preHandler', async (req) => {
  if (req.url.startsWith('/v1/traces')) {
    req.ingest = { orgId: '00000000-0000-0000-0000-000000000000' }
  } else {
    req.auth = {
      user: { id: 'u', email: 'e', orgId: '00000000-0000-0000-0000-000000000000' },
    }
  }
})
```

(Place this between `app = Fastify()` and the `app.register(...)` calls.)

### Step 7: Write `apps/server/test/isolation/cross-org.test.ts`

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { createTestDb, truncateAll } from '../helpers/db.js'
import { apiRoutes } from '../../src/modules/api/index.js'
import { ingestRoutes } from '../../src/modules/ingest/index.js'
import { PgStorage } from '../../src/modules/storage/pg.js'
import { InProcMessageBus } from '../../src/modules/pubsub/index.js'
import { createUser } from '../../src/modules/auth/dao.js'
import { hashPassword } from '../../src/modules/auth/password.js'
import { createTokenForProject } from '../../src/modules/tokens/dao.js'

const HEX_TRACE = '0123456789abcdef0123456789abcdef'
const HEX_SPAN = 'aaaaaaaaaaaaaaaa'

function payload(projectName: string) {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: 'argus.project', value: { stringValue: projectName } },
            { key: 'argus.service', value: { stringValue: 's1' } },
          ],
        },
        scopeSpans: [
          {
            spans: [
              {
                traceId: HEX_TRACE,
                spanId: HEX_SPAN,
                name: 'a',
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

describe('cross-org isolation', () => {
  const db = createTestDb()
  const storage = new PgStorage(db)
  const bus = new InProcMessageBus()

  beforeEach(async () => {
    await truncateAll(db)
  })

  afterAll(async () => {
    await db.destroy()
  })

  async function makeIngestApp(orgId: string) {
    const app = Fastify()
    app.addHook('preHandler', async (req) => {
      req.ingest = { orgId }
    })
    await app.register(ingestRoutes, { storage, bus })
    return app
  }

  async function makeQueryApp(orgId: string) {
    const app = Fastify()
    app.addHook('preHandler', async (req) => {
      req.auth = { user: { id: 'u', email: 'e', orgId } }
    })
    await app.register(apiRoutes, { storage })
    return app
  }

  it('user A writes a trace; user B cannot see it in /api/sessions', async () => {
    const a = await createUser(db, {
      email: 'alice@example.com',
      passwordHash: await hashPassword('pwpwpwpw'),
      orgName: 'a-org',
    })
    const b = await createUser(db, {
      email: 'bob@example.com',
      passwordHash: await hashPassword('pwpwpwpw'),
      orgName: 'b-org',
    })

    const ingestA = await makeIngestApp(a.orgId)
    await ingestA.inject({
      method: 'POST',
      url: '/v1/traces',
      payload: payload('alice-project'),
    })
    await ingestA.close()

    const queryB = await makeQueryApp(b.orgId)
    const res = await queryB.inject({ method: 'GET', url: '/api/sessions' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ sessions: [] })
    await queryB.close()

    const queryA = await makeQueryApp(a.orgId)
    const ownRes = await queryA.inject({ method: 'GET', url: '/api/sessions' })
    expect((ownRes.json() as { sessions: unknown[] }).sessions).toHaveLength(1)
    await queryA.close()
  })

  it("user B with user A's session UUID still gets 404", async () => {
    const a = await createUser(db, {
      email: 'a@example.com',
      passwordHash: await hashPassword('pwpwpwpw'),
      orgName: 'a-org',
    })
    const b = await createUser(db, {
      email: 'b@example.com',
      passwordHash: await hashPassword('pwpwpwpw'),
      orgName: 'b-org',
    })

    const ingestA = await makeIngestApp(a.orgId)
    await ingestA.inject({ method: 'POST', url: '/v1/traces', payload: payload('p') })
    await ingestA.close()

    const queryA = await makeQueryApp(a.orgId)
    const aSessions = (await queryA
      .inject({ method: 'GET', url: '/api/sessions' })
      .then((r) => r.json())) as { sessions: Array<{ id: string }> }
    const stolenId = aSessions.sessions[0]!.id
    await queryA.close()

    const queryB = await makeQueryApp(b.orgId)
    const res = await queryB.inject({ method: 'GET', url: `/api/sessions/${stolenId}` })
    expect(res.statusCode).toBe(404)
    await queryB.close()
  })

  it("token created in org A can't be used to write to org B's data", async () => {
    const a = await createUser(db, {
      email: 'a@example.com',
      passwordHash: await hashPassword('pwpwpwpw'),
      orgName: 'a-org',
    })
    const created = await createTokenForProject(db, {
      orgId: a.orgId,
      projectName: 'a-proj',
      tokenName: 't',
    })

    // The token resolves to a's org. Even if the payload claims a different
    // project name, the ingest route overrides it to the token's project.
    const ingestApp = Fastify()
    ingestApp.addHook('preHandler', async (req) => {
      req.ingest = {
        orgId: created ? a.orgId : '',
        projectId: created.projectId,
        projectName: 'a-proj',
      }
    })
    await ingestApp.register(ingestRoutes, { storage, bus })

    await ingestApp.inject({
      method: 'POST',
      url: '/v1/traces',
      payload: payload('attempted-foreign-project'),
    })
    await ingestApp.close()

    // Verify the session lives under a-proj, not the attacker-claimed name.
    const queryA = await makeQueryApp(a.orgId)
    const list = (await queryA
      .inject({ method: 'GET', url: '/api/sessions' })
      .then((r) => r.json())) as { sessions: Array<{ projectName: string }> }
    expect(list.sessions[0]?.projectName).toBe('a-proj')
    await queryA.close()
  })
})
```

### Step 8: Run all tests

```bash
pnpm --filter @argus/server test
```

Expected: typecheck + lint + tests all pass. Total: ~64 tests (61 + 3 isolation).

### Step 9: Smoke-test end-to-end with multi-tenant mode

```bash
pnpm db:up
sleep 5
pnpm db:migrate

# Multi-tenant mode
JWT_SECRET=this-is-thirty-two-chars-long-yo ARGUS_MODE=multi-tenant DATABASE_URL=postgres://argus:argus@localhost:5432/argus \
  pnpm --filter @argus/server dev > /tmp/argus.log 2>&1 &
SERVER_PID=$!
sleep 3

# Register
echo "--- register ---"
curl -sf -c /tmp/cookies.txt -X POST http://localhost:4000/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"alice@example.com","password":"hunter2-strong"}'
echo ""

# Create a token (with cookie)
echo "--- create token ---"
TOKEN_RESP=$(curl -sf -b /tmp/cookies.txt -X POST http://localhost:4000/api/tokens \
  -H 'Content-Type: application/json' \
  -d '{"projectName":"smoke","tokenName":"first"}')
echo "$TOKEN_RESP"
TOKEN=$(echo "$TOKEN_RESP" | python3 -c 'import sys,json; print(json.load(sys.stdin)["token"])')
echo "Token: $TOKEN"

# Push trace WITH bearer token
echo "--- push trace with bearer ---"
curl -sf -X POST http://localhost:4000/v1/traces \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  --data-binary @scripts/example-trace.json

# Push trace WITHOUT bearer -> 401
echo "--- push trace without bearer (expect 401) ---"
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:4000/v1/traces \
  -H 'Content-Type: application/json' \
  --data-binary @scripts/example-trace.json

# List sessions (with cookie)
echo "--- list sessions ---"
curl -sf -b /tmp/cookies.txt http://localhost:4000/api/sessions | python3 -m json.tool | head -30

kill $SERVER_PID 2>/dev/null
wait $SERVER_PID 2>/dev/null || true
pnpm db:down
rm -f /tmp/cookies.txt
```

Expected:

- register returns a user JSON
- create token returns `{ token: "argus_...", record: {...} }`
- push with bearer returns `{"accepted":N}`
- push without bearer returns 401
- list sessions returns the freshly-ingested session

### Step 10: Commit

```bash
git add apps/server
git commit -m "feat(server): wire auth + ingest tokens into existing routes; cross-org isolation tests"
```

---

## Task 9: Web — AuthProvider + login/register pages + auth API client

**Files:**

- Modify: `apps/web/src/lib/api.ts` (add auth + token endpoints)
- Create: `apps/web/src/lib/auth-provider.tsx`
- Create: `apps/web/src/routes/login.tsx`
- Create: `apps/web/src/routes/register.tsx`

### Step 1: Replace `apps/web/src/lib/api.ts`

```ts
import {
  GetSessionResponseSchema,
  ListSessionsResponseSchema,
  type GetSessionResponse,
  type ListSessionsResponse,
} from '@argus/shared-types'

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, { credentials: 'same-origin', ...init })
  if (res.status === 401) throw new Error('UNAUTHENTICATED')
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`)
  return res.json()
}

export async function fetchSessions(): Promise<ListSessionsResponse> {
  return ListSessionsResponseSchema.parse(await fetchJson('/api/sessions'))
}

export async function fetchSession(id: string): Promise<GetSessionResponse> {
  return GetSessionResponseSchema.parse(await fetchJson(`/api/sessions/${id}`))
}

// ---------- auth ----------

export interface AuthUser {
  id: string
  email: string
  orgId: string
}

export async function fetchMe(): Promise<AuthUser | null> {
  try {
    const data = (await fetchJson('/auth/me')) as { user: AuthUser }
    return data.user
  } catch (err) {
    if ((err as Error).message === 'UNAUTHENTICATED') return null
    throw err
  }
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const data = (await fetchJson('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })) as { user: AuthUser }
  return data.user
}

export async function register(email: string, password: string): Promise<AuthUser> {
  const data = (await fetchJson('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })) as { user: AuthUser }
  return data.user
}

export async function logout(): Promise<void> {
  await fetchJson('/auth/logout', { method: 'POST' })
}

// ---------- tokens ----------

export interface TokenRecord {
  id: string
  projectId: string
  projectName: string
  name: string
  prefix: string
  createdAt: string
  revokedAt: string | null
}

export async function listTokens(): Promise<TokenRecord[]> {
  const data = (await fetchJson('/api/tokens')) as { tokens: TokenRecord[] }
  return data.tokens
}

export interface CreatedToken {
  token: string
  record: {
    id: string
    projectId: string
    name: string
    prefix: string
    createdAt: string
  }
}

export async function createToken(input: {
  projectName: string
  tokenName: string
}): Promise<CreatedToken> {
  return (await fetchJson('/api/tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })) as CreatedToken
}

export async function revokeToken(id: string): Promise<void> {
  await fetchJson(`/api/tokens/${id}`, { method: 'DELETE' })
}
```

### Step 2: Create `apps/web/src/lib/auth-provider.tsx`

```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import {
  fetchMe,
  login as apiLogin,
  logout as apiLogout,
  register as apiRegister,
  type AuthUser,
} from './api'

interface AuthContextValue {
  user: AuthUser | null
  loading: boolean
  login: (email: string, password: string) => Promise<AuthUser>
  register: (email: string, password: string) => Promise<AuthUser>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = async () => {
    try {
      const me = await fetchMe()
      setUser(me)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const value: AuthContextValue = {
    user,
    loading,
    login: async (email, password) => {
      const u = await apiLogin(email, password)
      setUser(u)
      return u
    },
    register: async (email, password) => {
      const u = await apiRegister(email, password)
      setUser(u)
      return u
    },
    logout: async () => {
      await apiLogout()
      setUser(null)
    },
    refresh,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
```

### Step 3: Create `apps/web/src/routes/login.tsx`

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
    <div className="min-h-screen flex items-center justify-center p-6">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4 border rounded p-6">
        <h1 className="text-xl font-semibold">Sign in to Argus</h1>
        <label className="block">
          <span className="text-sm text-neutral-600">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="mt-1 w-full border rounded px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-sm text-neutral-600">Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className="mt-1 w-full border rounded px-3 py-2 text-sm"
          />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full bg-neutral-900 text-white rounded py-2 text-sm disabled:opacity-50"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="text-xs text-neutral-500 text-center">
          No account?{' '}
          <Link to="/register" className="text-blue-700 hover:underline">
            Register
          </Link>
        </p>
      </form>
    </div>
  )
}
```

### Step 4: Create `apps/web/src/routes/register.tsx`

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
    <div className="min-h-screen flex items-center justify-center p-6">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4 border rounded p-6">
        <h1 className="text-xl font-semibold">Create your Argus account</h1>
        <label className="block">
          <span className="text-sm text-neutral-600">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="mt-1 w-full border rounded px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-sm text-neutral-600">Password (min 8 chars)</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className="mt-1 w-full border rounded px-3 py-2 text-sm"
          />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full bg-neutral-900 text-white rounded py-2 text-sm disabled:opacity-50"
        >
          {submitting ? 'Creating…' : 'Create account'}
        </button>
        <p className="text-xs text-neutral-500 text-center">
          Already have one?{' '}
          <Link to="/login" className="text-blue-700 hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  )
}
```

### Step 5: Regenerate route tree

```bash
pnpm --filter @argus/web dev > /tmp/web.log 2>&1 &
WEB_PID=$!
sleep 6
kill $WEB_PID 2>/dev/null
wait $WEB_PID 2>/dev/null || true
```

### Step 6: Typecheck + build

```bash
pnpm --filter @argus/web typecheck
pnpm --filter @argus/web build
```

Expected: 0 errors.

### Step 7: Commit

```bash
git add apps/web/src/lib apps/web/src/routes/login.tsx apps/web/src/routes/register.tsx apps/web/src/routeTree.gen.ts
git commit -m "feat(web): auth provider + login + register pages"
```

---

## Task 10: Web — topbar user menu + protected routes

**Files:**

- Modify: `apps/web/src/routes/__root.tsx`

### Step 1: Replace `apps/web/src/routes/__root.tsx`

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
      <div className="h-screen flex items-center justify-center text-neutral-500">Loading…</div>
    )
  }
  return (
    <div className="h-screen flex flex-col">
      <header className="border-b px-6 py-3 flex items-center gap-4 shrink-0">
        <Link to="/" className="text-lg font-bold tracking-tight">
          Argus
        </Link>
        <nav className="text-sm text-neutral-500 flex items-center gap-3">
          <Link to="/sessions" className="hover:text-neutral-900">
            Sessions
          </Link>
          {user && (
            <Link to="/settings/tokens" className="hover:text-neutral-900">
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
    <Link to="/login" className="text-sm text-blue-700 hover:underline">
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
        className="text-sm text-neutral-700 hover:text-neutral-900 border rounded px-3 py-1"
      >
        {user!.email}
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-48 bg-white border rounded shadow text-sm z-50">
          <button
            type="button"
            onClick={handleLogout}
            className="block w-full text-left px-3 py-2 hover:bg-neutral-50"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
```

### Step 2: Update `apps/web/src/routes/sessions.tsx` to redirect unauthenticated users to /login when not in local mode

Actually, the cleanest approach is to let the route data loader handle it via the API: if `fetchSessions()` throws `UNAUTHENTICATED`, redirect to /login. For M4 compact, do this in the sessions index route.

Modify `apps/web/src/routes/sessions/index.tsx` — update the loading/error handling. Replace the file with:

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

### Step 3: Regenerate route tree

```bash
pnpm --filter @argus/web dev > /tmp/web.log 2>&1 &
WEB_PID=$!
sleep 6
kill $WEB_PID 2>/dev/null
wait $WEB_PID 2>/dev/null || true
```

### Step 4: Typecheck + build

```bash
pnpm --filter @argus/web typecheck
pnpm --filter @argus/web build
```

### Step 5: Commit

```bash
git add apps/web/src/routes apps/web/src/routeTree.gen.ts
git commit -m "feat(web): topbar user menu + unauthenticated redirect to /login"
```

---

## Task 11: Web — Settings/Tokens page

**Files:**

- Create: `apps/web/src/routes/settings/route.tsx`
- Create: `apps/web/src/routes/settings/tokens.tsx`

### Step 1: Create `apps/web/src/routes/settings/route.tsx`

```tsx
import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/settings')({
  component: () => <Outlet />,
})
```

### Step 2: Create `apps/web/src/routes/settings/tokens.tsx`

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

  if (isLoading) return <p className="p-6 text-neutral-500">Loading…</p>
  if (error) return <p className="p-6 text-red-600">Error: {String(error)}</p>

  return (
    <div className="p-6 space-y-6 overflow-auto h-full">
      <header>
        <h2 className="text-lg font-semibold">Ingest tokens</h2>
        <p className="text-sm text-neutral-500">
          Use a token in the{' '}
          <code className="bg-neutral-100 px-1 rounded">Authorization: Bearer</code> header when
          POSTing to <code className="bg-neutral-100 px-1 rounded">/v1/traces</code>. The token's
          project determines where the traces land.
        </p>
      </header>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (projectName && tokenName) create.mutate()
        }}
        className="border rounded p-4 space-y-3 max-w-xl"
      >
        <h3 className="text-sm font-semibold">Create a new token</h3>
        <label className="block text-sm">
          Project name
          <input
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="e.g. customer-bot"
            required
            className="mt-1 w-full border rounded px-3 py-1.5"
          />
        </label>
        <label className="block text-sm">
          Token name
          <input
            value={tokenName}
            onChange={(e) => setTokenName(e.target.value)}
            placeholder="e.g. production"
            required
            className="mt-1 w-full border rounded px-3 py-1.5"
          />
        </label>
        <button
          type="submit"
          disabled={create.isPending}
          className="bg-neutral-900 text-white rounded px-3 py-1.5 text-sm disabled:opacity-50"
        >
          {create.isPending ? 'Creating…' : 'Create token'}
        </button>
        {create.error && <p className="text-sm text-red-600">{String(create.error)}</p>}
      </form>

      {revealed && (
        <div className="border border-amber-300 bg-amber-50 rounded p-4 space-y-2 max-w-xl">
          <p className="text-sm font-semibold">Save this token now — it will not be shown again.</p>
          <pre className="text-xs bg-white border p-2 rounded break-all">{revealed.token}</pre>
          <button
            type="button"
            onClick={() => setRevealed(null)}
            className="text-sm text-neutral-700 underline"
          >
            I've saved it
          </button>
        </div>
      )}

      <section>
        <h3 className="text-sm font-semibold mb-2">Existing tokens</h3>
        {data && data.length === 0 && <p className="text-sm text-neutral-500">(no tokens yet)</p>}
        {data && data.length > 0 && (
          <table className="w-full text-sm border-t">
            <thead className="text-left text-neutral-500">
              <tr>
                <th className="py-2">Project</th>
                <th>Name</th>
                <th>Prefix</th>
                <th>Created</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.map((t: TokenRecord) => (
                <tr key={t.id} className="border-t">
                  <td className="py-2">{t.projectName}</td>
                  <td>{t.name}</td>
                  <td className="font-mono text-xs">{t.prefix}…</td>
                  <td className="text-neutral-500">{new Date(t.createdAt).toLocaleString()}</td>
                  <td>
                    {t.revokedAt ? (
                      <Badge variant="secondary">revoked</Badge>
                    ) : (
                      <Badge variant="default">active</Badge>
                    )}
                  </td>
                  <td className="text-right">
                    {!t.revokedAt && (
                      <button
                        type="button"
                        onClick={() => revoke.mutate(t.id)}
                        className="text-xs text-red-700 hover:underline"
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
```

### Step 3: Regenerate route tree

```bash
pnpm --filter @argus/web dev > /tmp/web.log 2>&1 &
WEB_PID=$!
sleep 6
kill $WEB_PID 2>/dev/null
wait $WEB_PID 2>/dev/null || true
```

### Step 4: Typecheck + build

```bash
pnpm --filter @argus/web typecheck
pnpm --filter @argus/web build
```

### Step 5: Commit

```bash
git add apps/web/src/routes/settings apps/web/src/routeTree.gen.ts
git commit -m "feat(web): settings/tokens page (list / create / revoke with reveal-once)"
```

---

## Task 12: End-to-end acceptance + tag

No code changes. Verification + tagging.

### Step 1: Clean install + full pipeline

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

Expected: typecheck/lint/build 0 errors. Tests: ~64 server + 14 web = 78 total.

### Step 2: Local-mode smoke (existing dev workflow still works)

```bash
pnpm db:up
sleep 5
pnpm db:migrate
pnpm db:seed
DATABASE_URL=postgres://argus:argus@localhost:5432/argus pnpm dev > /tmp/argus.log 2>&1 &
DEV_PID=$!
sleep 8

# In local mode, /auth/me returns the default user
curl -sf http://localhost:4000/auth/me | python3 -m json.tool
# /api/sessions works without cookie
curl -sf http://localhost:4000/api/sessions | python3 -m json.tool | head -10
# /v1/traces works without bearer
curl -sf -X POST http://localhost:4000/v1/traces \
  -H 'Content-Type: application/json' \
  --data-binary @scripts/example-trace.json

kill $DEV_PID 2>/dev/null
wait $DEV_PID 2>/dev/null || true
pnpm db:down
```

Expected:

- `/auth/me` returns `{user: {email: "local@argus.dev", ...}}`
- `/api/sessions` returns the seeded session
- `/v1/traces` returns 200

### Step 3: Multi-tenant smoke (the headline M4 deliverable)

```bash
pnpm db:up
sleep 5
pnpm db:migrate

# Multi-tenant mode requires JWT_SECRET (32+ chars).
ARGUS_MODE=multi-tenant \
JWT_SECRET=multi-tenant-smoke-test-secret-xxx \
DATABASE_URL=postgres://argus:argus@localhost:5432/argus \
pnpm --filter @argus/server dev > /tmp/argus.log 2>&1 &
SERVER_PID=$!
sleep 4

# Register two users
echo "--- register alice ---"
curl -sf -c /tmp/cookies-alice.txt -X POST http://localhost:4000/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"alice@example.com","password":"alice-strong-pw"}' | python3 -m json.tool

echo "--- register bob ---"
curl -sf -c /tmp/cookies-bob.txt -X POST http://localhost:4000/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"bob@example.com","password":"bob-strong-pw-here"}' | python3 -m json.tool

# Alice mints a token
echo "--- alice creates token ---"
ALICE_TOKEN_JSON=$(curl -sf -b /tmp/cookies-alice.txt -X POST http://localhost:4000/api/tokens \
  -H 'Content-Type: application/json' \
  -d '{"projectName":"alice-bot","tokenName":"first"}')
echo "$ALICE_TOKEN_JSON"
ALICE_TOKEN=$(echo "$ALICE_TOKEN_JSON" | python3 -c 'import sys,json; print(json.load(sys.stdin)["token"])')

# Alice pushes a trace
echo "--- alice pushes trace ---"
curl -sf -X POST http://localhost:4000/v1/traces \
  -H "Authorization: Bearer $ALICE_TOKEN" \
  -H 'Content-Type: application/json' \
  --data-binary @scripts/example-trace.json

# Alice sees her session
echo "--- alice sees 1 session ---"
curl -sf -b /tmp/cookies-alice.txt http://localhost:4000/api/sessions | python3 -c 'import sys,json; d=json.load(sys.stdin); print(f"alice sees: {len(d[\"sessions\"])} sessions")'

# Bob sees 0 sessions (cross-org isolation)
echo "--- bob sees 0 sessions ---"
curl -sf -b /tmp/cookies-bob.txt http://localhost:4000/api/sessions | python3 -c 'import sys,json; d=json.load(sys.stdin); print(f"bob sees: {len(d[\"sessions\"])} sessions")'

# Push without bearer -> 401
echo "--- push without token returns 401 ---"
curl -s -o /dev/null -w "HTTP %{http_code}\n" -X POST http://localhost:4000/v1/traces \
  -H 'Content-Type: application/json' \
  --data-binary @scripts/example-trace.json

# /api/sessions without cookie -> 401
echo "--- query without cookie returns 401 ---"
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:4000/api/sessions

kill $SERVER_PID 2>/dev/null
wait $SERVER_PID 2>/dev/null || true
pnpm db:down
rm -f /tmp/cookies-alice.txt /tmp/cookies-bob.txt
```

Expected outputs verify:

- alice sees: 1 sessions
- bob sees: 0 sessions
- push without token returns HTTP 401
- query without cookie returns HTTP 401

### Step 4: Tag + push

```bash
git tag -a m4-multitenant-auth -m "M4 (Compact) multi-tenant + public registration complete

Acceptance:
- pnpm install/typecheck/lint/test/build all green
- Tests: ~64 server + 14 web (auth + token + isolation tests added)
- New user can: register, create project, mint token, push trace, see session
- Two accounts cannot see each other's data (cross-org isolation verified)
- ARGUS_MODE=local keeps zero-config dev workflow working
- ARGUS_MODE=multi-tenant enforces cookie auth on UI + bearer token on ingest
- Deferred to post-M4 hardening: email verification, RLS, audit log, password reset
"
git push origin main
git push origin m4-multitenant-auth
```

### Step 5: Confirm CI is green at https://github.com/tiven-ai/Argus/actions

---

## Acceptance Summary

M4 (Compact) is complete when:

- [ ] `pnpm install` clean
- [ ] `pnpm typecheck` / `lint` / `test` / `build` all exit 0
- [ ] ~64 server tests pass (M3 baseline 31 + auth/token/isolation additions)
- [ ] 14 web tests still pass (no new web tests in M4 compact)
- [ ] Local-mode smoke: existing seed + dev workflow unchanged
- [ ] Multi-tenant smoke: register → token → push trace → see session round-trip works
- [ ] Cross-org isolation: account B's `/api/sessions` shows 0 entries when A has 1
- [ ] Push without bearer returns 401 in multi-tenant
- [ ] Tag `m4-multitenant-auth` pushed; CI green

Once this lands, the next step is **M5 — gRPC ingest + DESIGN.md application** (apply Unifi Console tokens to Tailwind theme). Post-M4 hardening (email verification, RLS, audit log) can be picked up opportunistically.
