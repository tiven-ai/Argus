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
      sql<boolean>`created_at > now() - interval '${sql.raw(String(ISSUE_RATE_LIMIT_SECONDS))} seconds'`,
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
    .where(sql<boolean>`expires_at > now()`)
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
  expires_at: unknown
  consumed_at: unknown
  created_at: unknown
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
