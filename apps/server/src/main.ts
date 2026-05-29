import { loadEnv } from './env.js'
import { createServer } from './server.js'

async function main() {
  const env = loadEnv()
  const { app } = await createServer({
    databaseUrl: env.DATABASE_URL,
    logLevel: env.LOG_LEVEL,
    mode: env.ARGUS_MODE,
    jwtSecret: env.JWT_SECRET,
    cookieName: env.COOKIE_NAME,
  })

  await app.listen({ port: env.PORT, host: env.HOST })
  app.log.info(`Argus server listening on http://${env.HOST}:${env.PORT}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
