import Fastify, { type FastifyInstance } from 'fastify'
import type { Kysely } from 'kysely'
import type { DB } from './db/schema.js'
import { createKysely } from './db/kysely.js'
import { PgStorage } from './modules/storage/pg.js'
import { InProcMessageBus } from './modules/pubsub/index.js'
import type { MessageBus } from './modules/pubsub/types.js'
import { ingestRoutes } from './modules/ingest/index.js'
import { apiRoutes } from './modules/api/index.js'
import { pusherRoutes } from './modules/pusher/index.js'

export interface ServerOptions {
  databaseUrl: string
  logLevel?: string
}

export interface ArgusServer {
  app: FastifyInstance
  db: Kysely<DB>
  bus: MessageBus
}

export async function createServer(opts: ServerOptions): Promise<ArgusServer> {
  const app = Fastify({
    logger: { level: opts.logLevel ?? 'info' },
    bodyLimit: 8 * 1024 * 1024,
  })

  const db = createKysely(opts.databaseUrl)
  const storage = new PgStorage(db)
  const bus = new InProcMessageBus()

  app.get('/healthz', async () => ({ status: 'ok' }))
  await app.register(ingestRoutes, { storage, bus })
  await app.register(apiRoutes, { storage })
  await app.register(pusherRoutes, { storage, bus })

  app.addHook('onClose', async () => {
    bus.removeAllSubscribers()
    await db.destroy()
  })

  return { app, db, bus }
}
