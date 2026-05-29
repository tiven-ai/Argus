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
