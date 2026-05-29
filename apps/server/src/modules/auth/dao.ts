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

export async function markEmailVerified(db: Kysely<DB>, userId: string): Promise<void> {
  await db
    .updateTable('users')
    .set({ email_verified_at: new Date() })
    .where('id', '=', userId)
    .execute()
}

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
