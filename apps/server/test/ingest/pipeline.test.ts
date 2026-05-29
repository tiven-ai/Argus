import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import type { Kysely } from 'kysely'
import type { DB } from '../../src/db/schema.js'
import type { WriteTraceInput } from '../../src/modules/storage/types.js'
import { InProcMessageBus } from '../../src/modules/pubsub/index.js'
import { PgStorage } from '../../src/modules/storage/pg.js'
import { processIngestion } from '../../src/modules/ingest/index.js'
import { dbTenantPlugin } from '../../src/modules/db-tenant/index.js'
import { createAppRoleTestDb, createTestDb, truncateAll } from '../helpers/db.js'
import { DEFAULT_ORG_ID } from '../../src/constants.js'

const DEFAULT_ORG = DEFAULT_ORG_ID

function makeTrace(projectName: string): WriteTraceInput {
  const now = new Date('2026-05-29T12:00:00Z')
  return {
    orgId: DEFAULT_ORG,
    projectName,
    serviceName: 's1',
    traceId: '0'.repeat(32),
    sessionStartedAt: now,
    sessionEndedAt: new Date(now.getTime() + 1000),
    steps: [
      {
        spanId: 'a'.repeat(16),
        parentSpanId: null,
        name: 'test.span',
        kind: null,
        componentType: null,
        componentName: null,
        startedAt: now,
        endedAt: new Date(now.getTime() + 1000),
        attributes: {},
        statusCode: 'OK',
        statusMessage: null,
        events: [],
      },
    ],
  }
}

describe('processIngestion', () => {
  let app: FastifyInstance
  let appDb: Kysely<DB>
  let admin: Kysely<DB>
  const storage = new PgStorage()

  beforeAll(async () => {
    appDb = createAppRoleTestDb()
    admin = createTestDb()
    app = Fastify()
    await app.register(dbTenantPlugin, { db: appDb })
  })

  beforeEach(async () => {
    await truncateAll(admin)
  })

  afterAll(async () => {
    await app.close()
    await appDb.destroy()
    await admin.destroy()
  })

  it('writes traces and publishes each written step to the bus', async () => {
    const bus = new InProcMessageBus()
    const handler = vi.fn()
    const sessions = await app.withTenantTx(DEFAULT_ORG, (trx) =>
      storage.listSessions(trx, { orgId: DEFAULT_ORG }),
    )
    const subBefore = sessions.length

    const published: Array<{ channel: string; payload: unknown }> = []
    const realPublish = bus.publish.bind(bus)
    bus.publish = (ch, payload) => {
      published.push({ channel: ch, payload })
      return realPublish(ch, payload)
    }

    const result = await app.withTenantTx(DEFAULT_ORG, (trx) =>
      processIngestion(trx, [makeTrace('p1')], { orgId: DEFAULT_ORG }, { storage, bus }),
    )

    expect(result.accepted).toBe(1)
    expect(published).toHaveLength(1)
    expect(published[0]?.channel).toMatch(/^session:[0-9a-f-]+$/)
    const newSessions = await app.withTenantTx(DEFAULT_ORG, (trx) =>
      storage.listSessions(trx, { orgId: DEFAULT_ORG }),
    )
    expect(newSessions).toHaveLength(subBefore + 1)
    expect(newSessions[0]?.projectName).toBe('p1')

    expect(handler).not.toHaveBeenCalled() // sanity: we never subscribed
  })

  it('overrides projectName when ctx.projectName is set (token-scoped ingestion)', async () => {
    const bus = new InProcMessageBus()
    await app.withTenantTx(DEFAULT_ORG, (trx) =>
      processIngestion(
        trx,
        [makeTrace('attacker-claimed')],
        { orgId: DEFAULT_ORG, projectName: 'real-project' },
        { storage, bus },
      ),
    )
    const list = await app.withTenantTx(DEFAULT_ORG, (trx) =>
      storage.listSessions(trx, { orgId: DEFAULT_ORG }),
    )
    expect(list[0]?.projectName).toBe('real-project')
  })
})
