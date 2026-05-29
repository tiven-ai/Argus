import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import type { Kysely } from 'kysely'
import type { DB } from '../../src/db/schema.js'
import { createAppRoleTestDb, createTestDb, truncateAll } from '../helpers/db.js'
import { dbTenantPlugin } from '../../src/modules/db-tenant/index.js'
import { PgStorage } from '../../src/modules/storage/pg.js'
import type { NewStep } from '../../src/modules/storage/types.js'
import { DEFAULT_ORG_ID } from '../../src/constants.js'

const DEFAULT_ORG = DEFAULT_ORG_ID

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
  let app: FastifyInstance
  let appDb: Kysely<DB>
  let admin: Kysely<DB>
  let storage: PgStorage

  beforeAll(async () => {
    appDb = createAppRoleTestDb()
    admin = createTestDb()
    app = Fastify()
    await app.register(dbTenantPlugin, { db: appDb })
    storage = new PgStorage()
  })

  beforeEach(async () => {
    await truncateAll(admin)
  })

  afterAll(async () => {
    await app.close()
    await appDb.destroy()
    await admin.destroy()
  })

  describe('writeTrace', () => {
    it('creates project, service, session, and steps on first write', async () => {
      await app.withTenantTx(DEFAULT_ORG, (trx) =>
        storage.writeTrace(trx, {
          orgId: DEFAULT_ORG,
          projectName: 'p1',
          serviceName: 's1',
          traceId: '0'.repeat(32),
          sessionStartedAt: new Date('2026-05-28T12:00:00Z'),
          sessionEndedAt: new Date('2026-05-28T12:00:01Z'),
          steps: [makeStep()],
        }),
      )

      const sessions = await app.withTenantTx(DEFAULT_ORG, (trx) =>
        storage.listSessions(trx, { orgId: DEFAULT_ORG }),
      )
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
      await app.withTenantTx(DEFAULT_ORG, (trx) => storage.writeTrace(trx, input))
      await app.withTenantTx(DEFAULT_ORG, (trx) =>
        storage.writeTrace(trx, {
          ...input,
          sessionEndedAt: new Date('2026-05-28T12:00:02Z'),
          steps: [makeStep({ spanId: 'b'.repeat(16) })],
        }),
      )

      const sessions = await app.withTenantTx(DEFAULT_ORG, (trx) =>
        storage.listSessions(trx, { orgId: DEFAULT_ORG }),
      )
      expect(sessions).toHaveLength(1)
      expect(sessions[0]?.stepCount).toBe(2)
      expect(sessions[0]?.endedAt).toEqual(new Date('2026-05-28T12:00:02Z'))
    })

    it('returns sessionId and the written steps with DB ids', async () => {
      const traceId = '5'.repeat(32)
      const result = await app.withTenantTx(DEFAULT_ORG, (trx) =>
        storage.writeTrace(trx, {
          orgId: DEFAULT_ORG_ID,
          projectName: 'p1',
          serviceName: 's1',
          traceId,
          sessionStartedAt: new Date('2026-05-28T12:00:00Z'),
          sessionEndedAt: null,
          steps: [
            makeStep({ spanId: 'a'.repeat(16) }),
            makeStep({ spanId: 'b'.repeat(16), parentSpanId: 'a'.repeat(16) }),
          ],
        }),
      )
      expect(result.sessionId).toMatch(/^[0-9a-f-]{36}$/)
      expect(result.writtenSteps).toHaveLength(2)
      const spanIds = result.writtenSteps.map((s) => s.spanId).sort()
      expect(spanIds).toEqual(['a'.repeat(16), 'b'.repeat(16)])
      // Each returned step has a DB id assigned.
      for (const s of result.writtenSteps) {
        expect(s.id).toMatch(/^[0-9a-f-]{36}$/)
      }
    })

    it('returned writtenSteps include events', async () => {
      const result = await app.withTenantTx(DEFAULT_ORG, (trx) =>
        storage.writeTrace(trx, {
          orgId: DEFAULT_ORG_ID,
          projectName: 'p1',
          serviceName: 's1',
          traceId: '6'.repeat(32),
          sessionStartedAt: new Date('2026-05-28T12:00:00Z'),
          sessionEndedAt: null,
          steps: [
            makeStep({
              spanId: 'c'.repeat(16),
              events: [
                {
                  name: 'argus.input',
                  ts: new Date('2026-05-28T12:00:00.5Z'),
                  attributes: { text: 'hi' },
                },
              ],
            }),
          ],
        }),
      )
      expect(result.writtenSteps).toHaveLength(1)
      expect(result.writtenSteps[0]?.events).toHaveLength(1)
      expect(result.writtenSteps[0]?.events[0]?.attributes).toEqual({ text: 'hi' })
    })

    it('persists step events', async () => {
      await app.withTenantTx(DEFAULT_ORG, (trx) =>
        storage.writeTrace(trx, {
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
        }),
      )

      const sessions = await app.withTenantTx(DEFAULT_ORG, (trx) =>
        storage.listSessions(trx, { orgId: DEFAULT_ORG }),
      )
      const detail = await app.withTenantTx(DEFAULT_ORG, (trx) =>
        storage.getSession(trx, { orgId: DEFAULT_ORG, sessionId: sessions[0]!.id }),
      )
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
      await app.withTenantTx(DEFAULT_ORG, (trx) =>
        storage.writeTrace(trx, {
          ...base,
          traceId: 'a'.repeat(32),
          sessionStartedAt: new Date('2026-05-28T12:00:00Z'),
        }),
      )
      await app.withTenantTx(DEFAULT_ORG, (trx) =>
        storage.writeTrace(trx, {
          ...base,
          traceId: 'b'.repeat(32),
          sessionStartedAt: new Date('2026-05-28T12:00:05Z'),
        }),
      )

      const sessions = await app.withTenantTx(DEFAULT_ORG, (trx) =>
        storage.listSessions(trx, { orgId: DEFAULT_ORG }),
      )
      expect(sessions.map((s) => s.traceId)).toEqual(['b'.repeat(32), 'a'.repeat(32)])
    })

    it('respects limit', async () => {
      for (let i = 0; i < 5; i++) {
        await app.withTenantTx(DEFAULT_ORG, (trx) =>
          storage.writeTrace(trx, {
            orgId: DEFAULT_ORG,
            projectName: 'p1',
            serviceName: 's1',
            traceId: String(i).padStart(32, '0'),
            sessionStartedAt: new Date(`2026-05-28T12:00:0${i}Z`),
            sessionEndedAt: null,
            steps: [makeStep()],
          }),
        )
      }
      const sessions = await app.withTenantTx(DEFAULT_ORG, (trx) =>
        storage.listSessions(trx, { orgId: DEFAULT_ORG, limit: 2 }),
      )
      expect(sessions).toHaveLength(2)
    })
  })

  describe('getSession', () => {
    it('returns null for unknown id', async () => {
      const result = await app.withTenantTx(DEFAULT_ORG, (trx) =>
        storage.getSession(trx, {
          orgId: DEFAULT_ORG,
          sessionId: '00000000-0000-0000-0000-000000000000',
        }),
      )
      expect(result).toBeNull()
    })

    it('returns session with all steps and events', async () => {
      await app.withTenantTx(DEFAULT_ORG, (trx) =>
        storage.writeTrace(trx, {
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
        }),
      )
      const [summary] = await app.withTenantTx(DEFAULT_ORG, (trx) =>
        storage.listSessions(trx, { orgId: DEFAULT_ORG }),
      )
      const detail = await app.withTenantTx(DEFAULT_ORG, (trx) =>
        storage.getSession(trx, { orgId: DEFAULT_ORG, sessionId: summary!.id }),
      )
      expect(detail?.steps).toHaveLength(2)
      expect(detail?.steps[1]?.parentSpanId).toBe('a'.repeat(16))
    })

    it('returns null when sessionId exists in a different org', async () => {
      // Insert a session in default org
      await app.withTenantTx(DEFAULT_ORG_ID, (trx) =>
        storage.writeTrace(trx, {
          orgId: DEFAULT_ORG_ID,
          projectName: 'p1',
          serviceName: 's1',
          traceId: '4'.repeat(32),
          sessionStartedAt: new Date('2026-05-28T12:00:00Z'),
          sessionEndedAt: null,
          steps: [makeStep()],
        }),
      )
      const [summary] = await app.withTenantTx(DEFAULT_ORG_ID, (trx) =>
        storage.listSessions(trx, { orgId: DEFAULT_ORG_ID }),
      )
      // Query with a different (fake) orgId returns null even though the id exists
      const otherOrg = '11111111-1111-1111-1111-111111111111'
      const result = await app.withTenantTx(otherOrg, (trx) =>
        storage.getSession(trx, { orgId: otherOrg, sessionId: summary!.id }),
      )
      expect(result).toBeNull()
    })
  })
})
