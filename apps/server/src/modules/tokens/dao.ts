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
