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
