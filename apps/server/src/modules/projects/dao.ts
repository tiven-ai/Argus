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

export type CreateProjectResult = { status: 'ok'; row: ProjectRow } | { status: 'conflict' }

/** Creates a project. Returns 'conflict' if (org_id, name) already exists.
 * MUST run inside withTenantTx (projects is under FORCE RLS). */
export async function createProject(
  trx: Tx,
  orgId: string,
  name: string,
): Promise<CreateProjectResult> {
  const existing = await trx
    .selectFrom('projects')
    .where('org_id', '=', orgId)
    .where('name', '=', name)
    .select('id')
    .executeTakeFirst()
  if (existing) return { status: 'conflict' }
  const row = await trx
    .insertInto('projects')
    .values({ org_id: orgId, name })
    .returning(['id', 'name', 'created_at'])
    .executeTakeFirstOrThrow()
  return {
    status: 'ok',
    row: { id: row.id, name: row.name, createdAt: new Date(row.created_at as unknown as string) },
  }
}

export type RenameProjectResult =
  | { status: 'ok'; row: ProjectRow }
  | { status: 'conflict' }
  | { status: 'not_found' }

/** Renames a project owned by orgId. 'not_found' if it doesn't exist for the
 * org; 'conflict' if another project in the org already has the new name. */
export async function renameProject(
  trx: Tx,
  orgId: string,
  id: string,
  name: string,
): Promise<RenameProjectResult> {
  const current = await trx
    .selectFrom('projects')
    .where('org_id', '=', orgId)
    .where('id', '=', id)
    .select('id')
    .executeTakeFirst()
  if (!current) return { status: 'not_found' }
  const dup = await trx
    .selectFrom('projects')
    .where('org_id', '=', orgId)
    .where('name', '=', name)
    .where('id', '!=', id)
    .select('id')
    .executeTakeFirst()
  if (dup) return { status: 'conflict' }
  const row = await trx
    .updateTable('projects')
    .set({ name })
    .where('id', '=', id)
    .where('org_id', '=', orgId)
    .returning(['id', 'name', 'created_at'])
    .executeTakeFirstOrThrow()
  return {
    status: 'ok',
    row: { id: row.id, name: row.name, createdAt: new Date(row.created_at as unknown as string) },
  }
}

export type DeleteProjectResult = { status: 'ok'; name: string } | { status: 'not_found' }

/** Deletes a project owned by orgId. The DB cascade removes services, sessions,
 * steps, step_events, and ingest_tokens. Returns the deleted name (for audit)
 * or 'not_found'. */
export async function deleteProject(
  trx: Tx,
  orgId: string,
  id: string,
): Promise<DeleteProjectResult> {
  const current = await trx
    .selectFrom('projects')
    .where('org_id', '=', orgId)
    .where('id', '=', id)
    .select('name')
    .executeTakeFirst()
  if (!current) return { status: 'not_found' }
  await trx.deleteFrom('projects').where('id', '=', id).where('org_id', '=', orgId).execute()
  return { status: 'ok', name: current.name }
}
