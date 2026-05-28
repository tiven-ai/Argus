import { loadEnv } from './env.js'
import { createServer } from './server.js'

async function main() {
  const env = loadEnv()
  const { app } = await createServer({
    databaseUrl: env.DATABASE_URL,
    logLevel: env.LOG_LEVEL,
  })

  await app.listen({ port: env.PORT, host: env.HOST })
  app.log.info(`Argus server listening on http://${env.HOST}:${env.PORT}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
