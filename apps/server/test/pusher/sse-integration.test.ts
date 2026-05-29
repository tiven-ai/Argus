import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import type { AddressInfo } from 'node:net'
import { ingestRoutes } from '../../src/modules/ingest/index.js'
import { pusherRoutes } from '../../src/modules/pusher/index.js'
import { PgStorage } from '../../src/modules/storage/pg.js'
import { InProcMessageBus } from '../../src/modules/pubsub/index.js'
import { createTestDb, truncateAll } from '../helpers/db.js'
import type { FastifyInstance } from 'fastify'

const HEX_TRACE = '0123456789abcdef0123456789abcdef'
const HEX_SPAN = 'aaaaaaaaaaaaaaaa'

function makeOtlpPayload() {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: 'argus.project', value: { stringValue: 'p1' } },
            { key: 'argus.service', value: { stringValue: 's1' } },
          ],
        },
        scopeSpans: [
          {
            spans: [
              {
                traceId: HEX_TRACE,
                spanId: HEX_SPAN,
                name: 'span.a',
                startTimeUnixNano: '1779955200000000000',
                endTimeUnixNano: '1779955201000000000',
              },
            ],
          },
        ],
      },
    ],
  }
}

describe('SSE end-to-end: POST /v1/traces -> session stream', () => {
  const db = createTestDb()
  const storage = new PgStorage(db)
  const bus = new InProcMessageBus()
  let app: FastifyInstance
  let port: number

  beforeAll(async () => {
    app = Fastify()
    app.addHook('preHandler', async (req) => {
      if (req.url.startsWith('/v1/traces')) {
        req.ingest = { orgId: '00000000-0000-0000-0000-000000000000' }
      } else {
        req.auth = {
          user: { id: 'u', email: 'e', orgId: '00000000-0000-0000-0000-000000000000' },
        }
      }
    })
    await app.register(ingestRoutes, { storage, bus })
    await app.register(pusherRoutes, { storage, bus })
    await app.listen({ port: 0, host: '127.0.0.1' })
    port = (app.server.address() as AddressInfo).port
  })

  afterAll(async () => {
    bus.removeAllSubscribers()
    await app.close()
    await db.destroy()
  })

  beforeEach(async () => {
    await truncateAll(db)
  })

  it('publishes a step to a live SSE subscriber after ingest', async () => {
    // Pre-create the session by ingesting once.
    await fetch(`http://127.0.0.1:${port}/v1/traces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(makeOtlpPayload()),
    }).then(async (r) => {
      expect(r.status).toBe(200)
    })

    // Find the session id via storage (avoids depending on an API route).
    const [summary] = await storage.listSessions({
      orgId: '00000000-0000-0000-0000-000000000000',
    })
    expect(summary).toBeDefined()
    const sessionId = summary!.id

    // Open SSE.
    const controller = new AbortController()
    const ssePromise = fetch(`http://127.0.0.1:${port}/api/sessions/${sessionId}/stream`, {
      signal: controller.signal,
    })

    const sseRes = await ssePromise
    expect(sseRes.status).toBe(200)
    expect(sseRes.headers.get('content-type')).toMatch(/text\/event-stream/)
    const reader = sseRes.body!.getReader()
    const decoder = new TextDecoder()

    // Helper to read until we have at least one event terminator.
    // `residual` carries bytes past `\n\n` from one call to the next, so a TCP
    // chunk containing multiple events isn't dropped.
    let residual = ''
    async function readNextEvent(): Promise<string> {
      let buf = residual
      while (true) {
        const idx = buf.indexOf('\n\n')
        if (idx >= 0) {
          residual = buf.slice(idx + 2)
          return buf.slice(0, idx)
        }
        const { value, done } = await reader.read()
        if (done) throw new Error('SSE stream ended prematurely')
        buf += decoder.decode(value, { stream: true })
      }
    }

    // First event from server is "connected".
    const connectedRaw = await readNextEvent()
    const connectedData = JSON.parse(connectedRaw.replace(/^data: /, ''))
    expect(connectedData).toEqual({ type: 'connected' })

    // Now send a SECOND ingest with a new span — should arrive over SSE.
    const second = makeOtlpPayload()
    second.resourceSpans[0]!.scopeSpans[0]!.spans[0]!.spanId = 'bbbbbbbbbbbbbbbb'
    await fetch(`http://127.0.0.1:${port}/v1/traces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(second),
    })

    // Read the next event — expect a step event for span 'bbbb...'.
    const stepEventRaw = await readNextEvent()
    const idLine = stepEventRaw.split('\n').find((l) => l.startsWith('id:'))!
    const dataLine = stepEventRaw.split('\n').find((l) => l.startsWith('data:'))!
    const data = JSON.parse(dataLine.replace(/^data: /, '')) as {
      type: string
      step: { spanId: string; id: string }
    }
    expect(data.type).toBe('step')
    expect(data.step.spanId).toBe('bbbbbbbbbbbbbbbb')
    expect(idLine).toBe(`id: ${data.step.id}`)

    controller.abort()
  }, 15_000)
})
