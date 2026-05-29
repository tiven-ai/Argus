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
    // truncateAll preserves the seeded local user (USER_A), so cascade does not
    // fire on auth_one_time_tokens. Clear it explicitly so prior tokens don't leak.
    await sql`TRUNCATE TABLE auth_one_time_tokens`.execute(db)
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
