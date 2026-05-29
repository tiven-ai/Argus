import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import type { Kysely } from 'kysely'
import type { DB } from '../../src/db/schema.js'
import { GetSessionResponseSchema, ListSessionsResponseSchema } from '@argus/shared-types'
import { apiRoutes } from '../../src/modules/api/index.js'
import { PgStorage } from '../../src/modules/storage/pg.js'
import { dbTenantPlugin } from '../../src/modules/db-tenant/index.js'
import { createAppRoleTestDb, createTestDb, truncateAll } from '../helpers/db.js'

const ORG = '00000000-0000-0000-0000-000000000000'

describe('Query API routes', () => {
  let appDb: Kysely<DB>
  let admin: Kysely<DB>
  let storage: PgStorage
  let app: FastifyInstance

  beforeAll(async () => {
    appDb = createAppRoleTestDb()
    admin = createTestDb()
    storage = new PgStorage()
    app = Fastify()
    await app.register(dbTenantPlugin, { db: appDb })
    app.addHook('preHandler', async (req) => {
      req.auth = { user: { id: 'u', email: 'e', orgId: ORG, emailVerifiedAt: null } }
    })
    await app.register(apiRoutes, { storage })
  })

  beforeEach(async () => {
    await truncateAll(admin)
  })

  afterAll(async () => {
    await app.close()
    await appDb.destroy()
    await admin.destroy()
  })

  it('GET /api/sessions returns empty list initially', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/sessions' })
    expect(res.statusCode).toBe(200)
    expect(ListSessionsResponseSchema.parse(res.json())).toEqual({ sessions: [] })
  })

  it('GET /api/sessions returns sessions with shape matching shared-types schema', async () => {
    await app.withTenantTx(ORG, (trx) =>
      storage.writeTrace(trx, {
        orgId: ORG,
        projectName: 'p1',
        serviceName: 's1',
        traceId: '0'.repeat(32),
        sessionStartedAt: new Date('2026-05-28T12:00:00Z'),
        sessionEndedAt: new Date('2026-05-28T12:00:01Z'),
        steps: [
          {
            spanId: 'a'.repeat(16),
            parentSpanId: null,
            name: 'x',
            kind: null,
            componentType: null,
            componentName: null,
            startedAt: new Date('2026-05-28T12:00:00Z'),
            endedAt: new Date('2026-05-28T12:00:01Z'),
            attributes: {},
            statusCode: 'OK',
            statusMessage: null,
            events: [],
          },
        ],
      }),
    )

    const res = await app.inject({ method: 'GET', url: '/api/sessions' })
    expect(res.statusCode).toBe(200)
    const parsed = ListSessionsResponseSchema.parse(res.json())
    expect(parsed.sessions).toHaveLength(1)
    expect(parsed.sessions[0]?.projectName).toBe('p1')
  })

  it('GET /api/sessions/:id returns session detail with steps and events', async () => {
    await app.withTenantTx(ORG, (trx) =>
      storage.writeTrace(trx, {
        orgId: ORG,
        projectName: 'p1',
        serviceName: 's1',
        traceId: '1'.repeat(32),
        sessionStartedAt: new Date('2026-05-28T12:00:00Z'),
        sessionEndedAt: null,
        steps: [
          {
            spanId: 'a'.repeat(16),
            parentSpanId: null,
            name: 'x',
            kind: 'user_message',
            componentType: null,
            componentName: null,
            startedAt: new Date('2026-05-28T12:00:00Z'),
            endedAt: new Date('2026-05-28T12:00:01Z'),
            attributes: {},
            statusCode: 'OK',
            statusMessage: null,
            events: [
              {
                name: 'argus.input',
                ts: new Date('2026-05-28T12:00:00.5Z'),
                attributes: { text: 'hi' },
              },
            ],
          },
        ],
      }),
    )

    const list = await app.inject({ method: 'GET', url: '/api/sessions' })
    const sessionId = list.json().sessions[0].id

    const detailRes = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}`,
    })
    expect(detailRes.statusCode).toBe(200)
    const detail = GetSessionResponseSchema.parse(detailRes.json())
    expect(detail.steps).toHaveLength(1)
    expect(detail.steps[0]?.events[0]?.attributes).toEqual({ text: 'hi' })
  })

  it('GET /api/sessions/:id returns 404 for unknown id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/sessions/00000000-0000-0000-0000-000000000000',
    })
    expect(res.statusCode).toBe(404)
  })
})
