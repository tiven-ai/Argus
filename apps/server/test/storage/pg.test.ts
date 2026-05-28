import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Kysely } from 'kysely'
import type { DB } from '../../src/db/schema.js'
import { createTestDb, truncateAll } from '../helpers/db.js'
import { PgStorage } from '../../src/modules/storage/pg.js'
import type { NewStep } from '../../src/modules/storage/types.js'

const DEFAULT_ORG = '00000000-0000-0000-0000-000000000000'

function makeStep(overrides: Partial<NewStep> = {}): NewStep {
  const now = new Date('2026-05-28T12:00:00Z')
  return {
    spanId: 'aaaaaaaaaaaaaaaa',
    parentSpanId: null,
    name: 'test.span',
    kind: 'user_message',
    componentType: null,
    componentName: null,
    startedAt: now,
    endedAt: new Date(now.getTime() + 100),
    attributes: { foo: 'bar' },
    statusCode: 'OK',
    statusMessage: null,
    events: [],
    ...overrides,
  }
}

describe('PgStorage', () => {
  let db: Kysely<DB>
  let storage: PgStorage

  beforeEach(async () => {
    db = createTestDb()
    await truncateAll(db)
    storage = new PgStorage(db)
  })

  afterAll(async () => {
    await db.destroy()
  })

  describe('writeTrace', () => {
    it('creates project, service, session, and steps on first write', async () => {
      await storage.writeTrace({
        orgId: DEFAULT_ORG,
        projectName: 'p1',
        serviceName: 's1',
        traceId: '0'.repeat(32),
        sessionStartedAt: new Date('2026-05-28T12:00:00Z'),
        sessionEndedAt: new Date('2026-05-28T12:00:01Z'),
        steps: [makeStep()],
      })

      const sessions = await storage.listSessions({ orgId: DEFAULT_ORG })
      expect(sessions).toHaveLength(1)
      expect(sessions[0]?.projectName).toBe('p1')
      expect(sessions[0]?.serviceName).toBe('s1')
      expect(sessions[0]?.stepCount).toBe(1)
    })

    it('reuses existing project/service/session for the same trace_id', async () => {
      const input = {
        orgId: DEFAULT_ORG,
        projectName: 'p1',
        serviceName: 's1',
        traceId: '1'.repeat(32),
        sessionStartedAt: new Date('2026-05-28T12:00:00Z'),
        sessionEndedAt: null,
        steps: [makeStep({ spanId: 'a'.repeat(16) })],
      }
      await storage.writeTrace(input)
      await storage.writeTrace({
        ...input,
        sessionEndedAt: new Date('2026-05-28T12:00:02Z'),
        steps: [makeStep({ spanId: 'b'.repeat(16) })],
      })

      const sessions = await storage.listSessions({ orgId: DEFAULT_ORG })
      expect(sessions).toHaveLength(1)
      expect(sessions[0]?.stepCount).toBe(2)
      expect(sessions[0]?.endedAt).toEqual(new Date('2026-05-28T12:00:02Z'))
    })

    it('persists step events', async () => {
      await storage.writeTrace({
        orgId: DEFAULT_ORG,
        projectName: 'p1',
        serviceName: 's1',
        traceId: '2'.repeat(32),
        sessionStartedAt: new Date('2026-05-28T12:00:00Z'),
        sessionEndedAt: null,
        steps: [
          makeStep({
            events: [
              {
                name: 'argus.input',
                ts: new Date('2026-05-28T12:00:00.500Z'),
                attributes: { text: 'hi' },
              },
            ],
          }),
        ],
      })

      const sessions = await storage.listSessions({ orgId: DEFAULT_ORG })
      const detail = await storage.getSession(sessions[0]!.id)
      expect(detail?.steps[0]?.events).toHaveLength(1)
      expect(detail?.steps[0]?.events[0]?.name).toBe('argus.input')
      expect(detail?.steps[0]?.events[0]?.attributes).toEqual({ text: 'hi' })
    })
  })

  describe('listSessions', () => {
    it('returns sessions ordered by started_at desc', async () => {
      const base = {
        orgId: DEFAULT_ORG,
        projectName: 'p1',
        serviceName: 's1',
        sessionEndedAt: null,
        steps: [makeStep()],
      }
      await storage.writeTrace({
        ...base,
        traceId: 'a'.repeat(32),
        sessionStartedAt: new Date('2026-05-28T12:00:00Z'),
      })
      await storage.writeTrace({
        ...base,
        traceId: 'b'.repeat(32),
        sessionStartedAt: new Date('2026-05-28T12:00:05Z'),
      })

      const sessions = await storage.listSessions({ orgId: DEFAULT_ORG })
      expect(sessions.map((s) => s.traceId)).toEqual(['b'.repeat(32), 'a'.repeat(32)])
    })

    it('respects limit', async () => {
      for (let i = 0; i < 5; i++) {
        await storage.writeTrace({
          orgId: DEFAULT_ORG,
          projectName: 'p1',
          serviceName: 's1',
          traceId: String(i).padStart(32, '0'),
          sessionStartedAt: new Date(`2026-05-28T12:00:0${i}Z`),
          sessionEndedAt: null,
          steps: [makeStep()],
        })
      }
      const sessions = await storage.listSessions({ orgId: DEFAULT_ORG, limit: 2 })
      expect(sessions).toHaveLength(2)
    })
  })

  describe('getSession', () => {
    it('returns null for unknown id', async () => {
      const result = await storage.getSession('00000000-0000-0000-0000-000000000000')
      expect(result).toBeNull()
    })

    it('returns session with all steps and events', async () => {
      await storage.writeTrace({
        orgId: DEFAULT_ORG,
        projectName: 'p1',
        serviceName: 's1',
        traceId: '3'.repeat(32),
        sessionStartedAt: new Date('2026-05-28T12:00:00Z'),
        sessionEndedAt: new Date('2026-05-28T12:00:02Z'),
        steps: [
          makeStep({ spanId: 'a'.repeat(16) }),
          makeStep({ spanId: 'b'.repeat(16), parentSpanId: 'a'.repeat(16) }),
        ],
      })
      const [summary] = await storage.listSessions({ orgId: DEFAULT_ORG })
      const detail = await storage.getSession(summary!.id)
      expect(detail?.steps).toHaveLength(2)
      expect(detail?.steps[1]?.parentSpanId).toBe('a'.repeat(16))
    })
  })
})
