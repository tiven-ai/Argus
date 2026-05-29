import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import type { Kysely } from 'kysely'
import type { DB } from '../../src/db/schema.js'
import { ingestRoutes } from '../../src/modules/ingest/index.js'
import { PgStorage } from '../../src/modules/storage/pg.js'
import { InProcMessageBus } from '../../src/modules/pubsub/index.js'
import { dbTenantPlugin } from '../../src/modules/db-tenant/index.js'
import { createAppRoleTestDb, createTestDb, truncateAll } from '../helpers/db.js'
import { DEFAULT_ORG_ID } from '../../src/constants.js'

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
  let appDb: Kysely<DB>
  let admin: Kysely<DB>
  const storage = new PgStorage()

  beforeAll(() => {
    appDb = createAppRoleTestDb()
    admin = createTestDb()
  })

  beforeEach(async () => {
    await truncateAll(admin)
  })

  afterAll(async () => {
    await appDb.destroy()
    await admin.destroy()
  })

  async function makeApp() {
    const app = Fastify()
    const bus = new InProcMessageBus()
    await app.register(dbTenantPlugin, { db: appDb })
    app.addHook('preHandler', async (req) => {
      req.ingest = { orgId: DEFAULT_ORG_ID }
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

    const sessions = await app.withTenantTx(DEFAULT_ORG_ID, (trx) =>
      storage.listSessions(trx, { orgId: DEFAULT_ORG_ID }),
    )
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
