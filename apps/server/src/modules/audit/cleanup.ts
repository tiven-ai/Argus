import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import type { DB } from '../../db/schema.js'

/**
 * Delete audit_log rows older than `retentionDays` days. Returns the count.
 * Pass the super-user `cleanupDb` pool — `audit_log` is under RLS, and the
 * argus_app role's DELETE evaluates the policy USING clause (which expects
 * a current_setting('argus.current_org_id') and would refuse the global sweep).
 *
 * No-op when retentionDays <= 0.
 */
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
