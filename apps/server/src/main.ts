import { createServer } from './server.js'

const port = Number(process.env.PORT ?? 4000)
const host = process.env.HOST ?? '0.0.0.0'

const app = createServer()

app
  .listen({ port, host })
  .then(() => {
    app.log.info(`Argus server listening on http://${host}:${port}`)
  })
  .catch((err) => {
    app.log.error(err)
    process.exit(1)
  })
