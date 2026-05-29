import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import type { Kysely } from 'kysely'
import { sql } from 'kysely'
import type { DB } from '../../db/schema.js'
import type { Tx } from './types.js'

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * Run `fn` inside a Kysely transaction with `argus.current_org_id` set so
     * tenant-data tables under RLS resolve to the caller's org. If `fn` throws,
     * the transaction rolls back; the GUC is local to the transaction so it
     * cannot leak back to the connection pool.
     */
    withTenantTx<T>(orgId: string, fn: (trx: Tx) => Promise<T>): Promise<T>
  }
}

export interface DbTenantDeps {
  db: Kysely<DB>
}

export const dbTenantPlugin: FastifyPluginAsync<DbTenantDeps> = async (
  app: FastifyInstance,
  deps,
) => {
  app.decorate('withTenantTx', function <T>(orgId: string, fn: (trx: Tx) => Promise<T>) {
    return deps.db.transaction().execute(async (trx) => {
      await sql`SELECT set_config('argus.current_org_id', ${orgId}, true)`.execute(trx)
      return fn(trx)
    })
  })
}
