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
