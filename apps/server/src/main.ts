import { loadEnv } from './env.js'
import { createServer } from './server.js'
import { startGrpcServer, type StartedGrpcServer } from './modules/ingest-grpc/index.js'

async function main() {
  const env = loadEnv()
  // loadEnv always populates APP_DATABASE_URL (either from env or derived from
  // DATABASE_URL by swapping in the argus_app role) — the `!` is therefore safe.
  const { app, db, bus } = await createServer({
    databaseUrl: env.DATABASE_URL,
    appDatabaseUrl: env.APP_DATABASE_URL!,
    logLevel: env.LOG_LEVEL,
    mode: env.ARGUS_MODE,
    jwtSecret: env.JWT_SECRET,
    cookieName: env.COOKIE_NAME,
  })

  await app.listen({ port: env.PORT, host: env.HOST })
  app.log.info(`Argus HTTP server listening on http://${env.HOST}:${env.PORT}`)

  // We need access to the storage/db/bus to wire the gRPC service. createServer
  // already constructed PgStorage. We pass the same db + a fresh PgStorage in
  // here (it's a thin wrapper with no per-instance state, instantiating twice
  // is fine), so we don't have to widen createServer's return shape.
  let grpc: StartedGrpcServer | undefined
  if (env.GRPC_PORT > 0) {
    const { PgStorage } = await import('./modules/storage/pg.js')
    grpc = await startGrpcServer({
      host: env.HOST,
      port: env.GRPC_PORT,
      db,
      storage: new PgStorage(),
      bus,
      mode: env.ARGUS_MODE,
      withTenantTx: app.withTenantTx.bind(app),
    })
    app.log.info(`Argus gRPC server listening on ${env.HOST}:${grpc.port}`)
  } else {
    app.log.info('Argus gRPC server disabled (GRPC_PORT=0)')
  }

  // Graceful shutdown so both servers close on SIGTERM.
  const shutdown = async () => {
    app.log.info('Shutting down…')
    await Promise.all([app.close(), grpc?.close() ?? Promise.resolve()])
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
