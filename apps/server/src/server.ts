import Fastify, { type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import type { Kysely } from 'kysely'
import type { DB } from './db/schema.js'
import { createKysely } from './db/kysely.js'
import { PgStorage } from './modules/storage/pg.js'
import { InProcMessageBus } from './modules/pubsub/index.js'
import type { MessageBus } from './modules/pubsub/types.js'
import { ingestRoutes } from './modules/ingest/index.js'
import { apiRoutes } from './modules/api/index.js'
import { pusherRoutes } from './modules/pusher/index.js'
import { authRoutes, resolveAuthContext, type AuthMiddlewareDeps } from './modules/auth/index.js'
import { resolveIngestContext, tokenManagementRoutes } from './modules/tokens/index.js'

export interface ServerOptions {
  databaseUrl: string
  logLevel?: string
  mode: 'local' | 'multi-tenant'
  jwtSecret: string
  cookieName: string
  cookieSecure?: boolean
  sessionTtlSeconds?: number
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

  await app.register(cookie)

  app.get('/healthz', async () => ({ status: 'ok' }))

  // Auth routes: always registered. In local mode the cookie isn't used but
  // registering routes lets the web app's AuthProvider hit /auth/me uniformly.
  await app.register(authRoutes, {
    db,
    cookieName: opts.cookieName,
    jwtSecret: opts.jwtSecret,
    cookieSecure: opts.cookieSecure ?? false,
    sessionTtlSeconds: opts.sessionTtlSeconds ?? 7 * 24 * 3600,
  })

  // Authenticated UI/query API + pusher SSE.
  const authDeps: AuthMiddlewareDeps = {
    db,
    mode: opts.mode,
    cookieName: opts.cookieName,
    jwtSecret: opts.jwtSecret,
  }
  await app.register(
    async (scope) => {
      scope.addHook('preHandler', resolveAuthContext(authDeps))
      await scope.register(apiRoutes, { storage })
      await scope.register(pusherRoutes, { storage, bus })
      await scope.register(tokenManagementRoutes, { db })
    },
    { prefix: '' },
  )

  // Ingest: bearer-token-protected in multi-tenant mode; open in local mode.
  await app.register(
    async (scope) => {
      scope.addHook('preHandler', resolveIngestContext({ db, mode: opts.mode }))
      await scope.register(ingestRoutes, { storage, bus })
    },
    { prefix: '' },
  )

  app.addHook('onClose', async () => {
    bus.removeAllSubscribers()
    await db.destroy()
  })

  return { app, db, bus }
}
