import { sql } from 'kysely'
import type { Tx } from '../db-tenant/index.js'
import type { RecordArgs } from './types.js'

const MAX_UA = 2048

/**
 * Insert one row into `audit_log`. The `org_id` comes from the active
 * `argus.current_org_id` GUC, which the caller's `withTenantTx` already set.
 *
 * If the GUC is not set, the INSERT violates RLS WITH CHECK and the underlying
 * Postgres error surfaces — that's the loud-fail mode by design.
 */
export async function record(trx: Tx, args: RecordArgs): Promise<void> {
  // Use missing_ok=true: once any session has touched the GUC via set_config,
  // subsequent tx that don't SET LOCAL it again see '' (empty string), not NULL
  // and not a thrown error. Detect both empty + null and throw a clear message.
  const { rows } = await sql<{ org_id: string | null }>`
    SELECT NULLIF(current_setting('argus.current_org_id', true), '') AS org_id
  `.execute(trx)
  const orgId = rows[0]?.org_id
  if (!orgId) {
    throw new Error('audit.record: argus.current_org_id GUC is not set on this transaction')
  }
  await trx
    .insertInto('audit_log')
    .values({
      org_id: orgId,
      actor_user_id: args.actorUserId,
      event_type: args.eventType,
      target_kind: args.targetKind ?? null,
      target_id: args.targetId ?? null,
      metadata: args.metadata ? JSON.stringify(args.metadata) : null,
      ip: args.ip ?? null,
      user_agent: args.userAgent ? args.userAgent.slice(0, MAX_UA) : null,
    })
    .execute()
}
