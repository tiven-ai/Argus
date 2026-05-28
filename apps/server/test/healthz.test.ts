import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type ArgusServer } from '../src/server.js'

describe('GET /healthz', () => {
  let server: ArgusServer | undefined

  afterEach(async () => {
    if (server) await server.app.close()
  })

  it('returns 200 and { status: "ok" }', async () => {
    server = await createServer({
      databaseUrl: process.env.DATABASE_URL!,
      logLevel: 'silent',
    })
    const res = await server.app.inject({ method: 'GET', url: '/healthz' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok' })
  })
})
