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
import { dbTenantPlugin } from './modules/db-tenant/index.js'
import { MockEmailSender, makeEmailSender, type EmailSender } from './modules/email/index.js'
import { cleanupExpiredTokens } from './modules/auth-tokens/index.js'
import { cleanupOldAuditLogs } from './modules/audit/index.js'

export interface ServerOptions {
  databaseUrl: string
  appDatabaseUrl: string
  logLevel?: string
  mode: 'local' | 'multi-tenant'
  jwtSecret: string
  cookieName: string
  cookieSecure?: boolean
  sessionTtlSeconds?: number
  resendApiKey?: string
  emailFrom?: string
  appBaseUrl: string
  /** Inject for tests; production builds from resendApiKey + emailFrom. */
  emailSender?: EmailSender
  /** Super-user pool for cleanup crons. If not provided, audit cron is skipped. */
  cleanupDb?: Kysely<DB>
  tokenCleanupIntervalMs?: number
  auditCleanupIntervalMs?: number
  auditRetentionDays?: number
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

  // Runtime pool uses the argus_app role; this is what app code touches.
  // The migration-role databaseUrl is reserved for migration runners only and
  // is not opened here.
  const db = createKysely(opts.appDatabaseUrl)
  const storage = new PgStorage()
  const bus = new InProcMessageBus()

  await app.register(cookie)
  await app.register(dbTenantPlugin, { db })

  // Build the email sender. Tests inject; production wires Resend via factory.
  // Without RESEND_API_KEY we install a MockEmailSender with throwOnSend=true
  // so boot succeeds but any actual send blows up loudly.
  let emailSender: EmailSender
  if (opts.emailSender) {
    emailSender = opts.emailSender
  } else if (opts.resendApiKey) {
    emailSender = makeEmailSender({
      resendApiKey: opts.resendApiKey,
      from: opts.emailFrom ?? 'Argus <noreply@argus.dev>',
    })
  } else {
    const mock = new MockEmailSender()
    mock.throwOnSend = true
    emailSender = mock
  }
  app.decorate('emailSender', emailSender)

  app.get('/healthz', async () => ({ status: 'ok' }))

  // Auth routes: always registered. In local mode the cookie isn't used but
  // registering routes lets the web app's AuthProvider hit /auth/me uniformly.
  // Auth middleware computed once and shared between the auth-context scope
  // (for /api/* + pusher) and the /auth/me route inside authRoutes.
  const authDeps: AuthMiddlewareDeps = {
    db,
    mode: opts.mode,
    cookieName: opts.cookieName,
    jwtSecret: opts.jwtSecret,
  }
  const authMiddleware = resolveAuthContext(authDeps)

  await app.register(authRoutes, {
    db,
    cookieName: opts.cookieName,
    jwtSecret: opts.jwtSecret,
    cookieSecure: opts.cookieSecure ?? false,
    sessionTtlSeconds: opts.sessionTtlSeconds ?? 7 * 24 * 3600,
    authMiddleware,
    emailSender: app.emailSender,
    appBaseUrl: opts.appBaseUrl,
  })

  await app.register(
    async (scope) => {
      scope.addHook('preHandler', authMiddleware)
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

  // Background cleanup crons. Both timers are .unref()'d so they don't keep the
  // event loop alive. The audit cleanup REQUIRES the super-user `cleanupDb`
  // pool because `audit_log` is under RLS — the argus_app role's DELETE would
  // evaluate the policy USING clause (which expects a per-org setting) and
  // refuse the global sweep.
  const timers: NodeJS.Timeout[] = []
  if (opts.tokenCleanupIntervalMs && opts.tokenCleanupIntervalMs > 0) {
    const t = setInterval(() => {
      cleanupExpiredTokens(db).catch((err) =>
        app.log.warn({ err, event: 'token_cleanup_failed' }, 'token cleanup failed'),
      )
    }, opts.tokenCleanupIntervalMs)
    t.unref()
    timers.push(t)
  }
  if (
    opts.cleanupDb &&
    opts.auditCleanupIntervalMs &&
    opts.auditCleanupIntervalMs > 0 &&
    opts.auditRetentionDays !== undefined &&
    opts.auditRetentionDays > 0
  ) {
    const cleanupDb = opts.cleanupDb
    const days = opts.auditRetentionDays
    const t = setInterval(() => {
      cleanupOldAuditLogs(cleanupDb, days).catch((err) =>
        app.log.warn({ err, event: 'audit_cleanup_failed' }, 'audit cleanup failed'),
      )
    }, opts.auditCleanupIntervalMs)
    t.unref()
    timers.push(t)
  }
  app.addHook('onClose', async () => {
    for (const t of timers) clearInterval(t)
  })

  return { app, db, bus }
}
