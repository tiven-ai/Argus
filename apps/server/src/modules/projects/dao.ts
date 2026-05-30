import type { Tx } from '../db-tenant/index.js'

export interface ProjectRow {
  id: string
  name: string
  createdAt: Date
}

/** Lists an org's projects, ordered by name. MUST run inside withTenantTx —
 * the projects table is under FORCE RLS. */
export async function listProjectsForOrg(trx: Tx, orgId: string): Promise<ProjectRow[]> {
  const rows = await trx
    .selectFrom('projects')
    .where('org_id', '=', orgId)
    .select(['id as id', 'name as name', 'created_at as createdAt'])
    .orderBy('name')
    .execute()
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    createdAt: new Date(r.createdAt as unknown as string),
  }))
}
