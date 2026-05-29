import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WriteTraceInput } from '../../src/modules/storage/types.js'
import { InProcMessageBus } from '../../src/modules/pubsub/index.js'
import { PgStorage } from '../../src/modules/storage/pg.js'
import { processIngestion } from '../../src/modules/ingest/index.js'
import { createTestDb, truncateAll } from '../helpers/db.js'

const DEFAULT_ORG = '00000000-0000-0000-0000-000000000000'

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
  const db = createTestDb()
  const storage = new PgStorage(db)

  beforeEach(async () => {
    await truncateAll(db)
  })

  afterAll(async () => {
    await db.destroy()
  })

  it('writes traces and publishes each written step to the bus', async () => {
    const bus = new InProcMessageBus()
    const handler = vi.fn()
    const sessions = await storage.listSessions({ orgId: DEFAULT_ORG })
    const subBefore = sessions.length

    const published: Array<{ channel: string; payload: unknown }> = []
    const realPublish = bus.publish.bind(bus)
    bus.publish = (ch, payload) => {
      published.push({ channel: ch, payload })
      return realPublish(ch, payload)
    }

    const result = await processIngestion(
      [makeTrace('p1')],
      { orgId: DEFAULT_ORG },
      {
        storage,
        bus,
      },
    )

    expect(result.accepted).toBe(1)
    expect(published).toHaveLength(1)
    expect(published[0]?.channel).toMatch(/^session:[0-9a-f-]+$/)
    const newSessions = await storage.listSessions({ orgId: DEFAULT_ORG })
    expect(newSessions).toHaveLength(subBefore + 1)
    expect(newSessions[0]?.projectName).toBe('p1')

    expect(handler).not.toHaveBeenCalled() // sanity: we never subscribed
  })

  it('overrides projectName when ctx.projectName is set (token-scoped ingestion)', async () => {
    const bus = new InProcMessageBus()
    await processIngestion(
      [makeTrace('attacker-claimed')],
      { orgId: DEFAULT_ORG, projectName: 'real-project' },
      { storage, bus },
    )
    const list = await storage.listSessions({ orgId: DEFAULT_ORG })
    expect(list[0]?.projectName).toBe('real-project')
  })
})
