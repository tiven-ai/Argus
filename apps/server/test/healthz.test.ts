import { describe, it, expect, afterEach } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { createServer } from '../src/server.js'

describe('GET /healthz', () => {
  let app: FastifyInstance | undefined

  afterEach(async () => {
    if (app) await app.close()
  })

  it('returns 200 and { status: "ok" }', async () => {
    app = createServer()
    const res = await app.inject({ method: 'GET', url: '/healthz' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok' })
  })
})
