import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { ingestRoutes } from '../../src/modules/ingest/index.js'
import { PgStorage } from '../../src/modules/storage/pg.js'
import { InProcMessageBus } from '../../src/modules/pubsub/index.js'
import { createTestDb, truncateAll } from '../helpers/db.js'

const HEX_TRACE = '0123456789abcdef0123456789abcdef'
const HEX_SPAN = 'aaaaaaaaaaaaaaaa'

function makePayload() {
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

describe('POST /v1/traces', () => {
  const db = createTestDb()
  const storage = new PgStorage(db)

  beforeEach(async () => {
    await truncateAll(db)
  })

  afterAll(async () => {
    await db.destroy()
  })

  async function makeApp() {
    const app = Fastify()
    const bus = new InProcMessageBus()
    app.addHook('preHandler', async (req) => {
      req.ingest = { orgId: '00000000-0000-0000-0000-000000000000' }
    })
    await app.register(ingestRoutes, { storage, bus })
    return app
  }

  it('persists a valid OTLP payload and returns accepted count', async () => {
    const app = await makeApp()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/traces',
      payload: makePayload(),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ accepted: 1 })

    const sessions = await storage.listSessions({
      orgId: '00000000-0000-0000-0000-000000000000',
    })
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.traceId).toBe(HEX_TRACE)
    await app.close()
  })

  it('returns 400 when argus.project is missing', async () => {
    const app = await makeApp()
    const payload = makePayload()
    payload.resourceSpans[0]!.resource!.attributes =
      payload.resourceSpans[0]!.resource!.attributes!.filter((a) => a.key !== 'argus.project')

    const res = await app.inject({ method: 'POST', url: '/v1/traces', payload })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('invalid_otlp_payload')
    await app.close()
  })

  it('returns 400 on malformed payload', async () => {
    const app = await makeApp()
    const res = await app.inject({
      method: 'POST',
      url: '/v1/traces',
      payload: { resourceSpans: 'nope' },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })
})
