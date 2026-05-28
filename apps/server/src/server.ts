import Fastify, { type FastifyInstance } from 'fastify'
import type { Kysely } from 'kysely'
import type { DB } from './db/schema.js'
import { createKysely } from './db/kysely.js'
import { PgStorage } from './modules/storage/pg.js'
import { ingestRoutes } from './modules/ingest/index.js'
import { apiRoutes } from './modules/api/index.js'

export interface ServerOptions {
  databaseUrl: string
  logLevel?: string
}

export interface ArgusServer {
  app: FastifyInstance
  db: Kysely<DB>
}

export async function createServer(opts: ServerOptions): Promise<ArgusServer> {
  const app = Fastify({
    logger: { level: opts.logLevel ?? 'info' },
    bodyLimit: 8 * 1024 * 1024, // 8 MiB for OTLP payloads
  })

  const db = createKysely(opts.databaseUrl)
  const storage = new PgStorage(db)

  app.get('/healthz', async () => ({ status: 'ok' }))
  await app.register(ingestRoutes, { storage })
  await app.register(apiRoutes, { storage })

  app.addHook('onClose', async () => {
    await db.destroy()
  })

  return { app, db }
}
