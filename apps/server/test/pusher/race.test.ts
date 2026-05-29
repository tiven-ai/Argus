import { describe, expect, test, beforeAll, afterAll, beforeEach } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import type { AddressInfo } from 'node:net'
import { InProcMessageBus } from '../../src/modules/pubsub/index.js'
import type { StorageBackend } from '../../src/modules/storage/types.js'
import { pusherRoutes } from '../../src/modules/pusher/index.js'
import { dbTenantPlugin } from '../../src/modules/db-tenant/index.js'
import { resolveAuthContext, type AuthMiddlewareDeps } from '../../src/modules/auth/index.js'
import { createAppRoleTestDb } from '../helpers/db.js'

describe('SSE reconnect-replay race', () => {
  let app: FastifyInstance
  let port: number
  const appDb = createAppRoleTestDb()
  const bus = new InProcMessageBus()
  const sessionId = 'ssss0000-0000-0000-0000-00000000000a'

  // Mock storage where getSession resolves on `gate`.
  let releaseGate: (() => void) | null = null
  const mockStorage: StorageBackend = {
    async writeTrace() {
      throw new Error('not used')
    },
    async listSessions() {
      return []
    },
    async getSession() {
      await new Promise<void>((resolve) => {
        releaseGate = resolve
      })
      return {
        id: sessionId,
        traceId: 'trace',
        projectName: 'p',
        serviceName: 's',
        startedAt: new Date(),
        endedAt: null,
        stepCount: 0,
        steps: [],
      }
    },
  }

  beforeAll(async () => {
    app = Fastify()
    await app.register(cookie)
    await app.register(dbTenantPlugin, { db: appDb })
    const authDeps: AuthMiddlewareDeps = {
      db: appDb,
      mode: 'local',
      cookieName: 'argus_session',
      jwtSecret: 'x'.repeat(32),
    }
    const authMiddleware = resolveAuthContext(authDeps)
    await app.register(
      async (scope) => {
        scope.addHook('preHandler', authMiddleware)
        await scope.register(pusherRoutes, { storage: mockStorage, bus })
      },
      { prefix: '' },
    )
    await app.listen({ port: 0, host: '127.0.0.1' })
    port = (app.server.address() as AddressInfo).port
  })
  beforeEach(() => {
    releaseGate = null
  })
  afterAll(async () => {
    bus.removeAllSubscribers()
    await app.close()
    await appDb.destroy()
  })

  test('step published during getSession is delivered exactly once', async () => {
    // app.inject can't be used here: reply.hijack() takes the response out of
    // Fastify's lifecycle, so inject's response promise never resolves. Use a
    // real HTTP request against the live listener instead (matches the pattern
    // in sse-integration.test.ts).
    const controller = new AbortController()
    const responsePromise = fetch(`http://127.0.0.1:${port}/api/sessions/${sessionId}/stream`, {
      signal: controller.signal,
    })

    // Give Fastify time to enter the handler, run withTenantTx setup,
    // and reach the (blocking) mock getSession. A microtask flush isn't enough
    // because withTenantTx awaits a real transaction begin against appDb.
    await new Promise((r) => setTimeout(r, 100))

    // Publish a step while getSession is still pending — subscribe MUST have happened by now.
    const step = {
      id: 'step-during-replay',
      sessionId,
      spanId: 'sp1',
      parentSpanId: null,
      name: 'op',
      kind: null,
      componentType: null,
      componentName: null,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      attributes: {},
      statusCode: 'OK',
      statusMessage: null,
      events: [],
    }
    bus.publish(`session:${sessionId}`, step)

    // Now release getSession.
    if (!releaseGate) throw new Error('getSession was not called yet')
    releaseGate!()

    // Read the SSE stream until we've seen both the connected event and the
    // step-during-replay event, then abort. Count occurrences in the captured
    // body to confirm exactly-once delivery.
    const response = await responsePromise
    expect(response.status).toBe(200)
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let body = ''
    const deadline = Date.now() + 2000
    while (Date.now() < deadline) {
      const { value, done } = await reader.read()
      if (done) break
      body += decoder.decode(value, { stream: true })
      if (body.includes('"connected"') && body.includes('step-during-replay')) break
    }
    controller.abort()

    // Each SSE event repeats the step id in both the `id:` envelope and the
    // JSON data line, so plain substring search double-counts. Anchor on the
    // envelope line.
    const matches = body.match(/^id: step-during-replay$/gm) ?? []
    expect(matches.length).toBe(1)
  }, 15_000)
})
