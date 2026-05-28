import Fastify, { type FastifyInstance } from 'fastify'

export function createServer(): FastifyInstance {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
    },
  })

  app.get('/healthz', async () => ({ status: 'ok' }))

  return app
}
