import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { createTestDb, truncateAll } from '../helpers/db.js'
import { apiRoutes } from '../../src/modules/api/index.js'
import { ingestRoutes } from '../../src/modules/ingest/index.js'
import { PgStorage } from '../../src/modules/storage/pg.js'
import { InProcMessageBus } from '../../src/modules/pubsub/index.js'
import { createUser } from '../../src/modules/auth/dao.js'
import { hashPassword } from '../../src/modules/auth/password.js'
import { createTokenForProject } from '../../src/modules/tokens/dao.js'

const HEX_TRACE = '0123456789abcdef0123456789abcdef'
const HEX_SPAN = 'aaaaaaaaaaaaaaaa'

function payload(projectName: string) {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: 'argus.project', value: { stringValue: projectName } },
            { key: 'argus.service', value: { stringValue: 's1' } },
          ],
        },
        scopeSpans: [
          {
            spans: [
              {
                traceId: HEX_TRACE,
                spanId: HEX_SPAN,
                name: 'a',
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

describe('cross-org isolation', () => {
  const db = createTestDb()
  const storage = new PgStorage(db)
  const bus = new InProcMessageBus()

  beforeEach(async () => {
    await truncateAll(db)
  })

  afterAll(async () => {
    await db.destroy()
  })

  async function makeIngestApp(orgId: string) {
    const app = Fastify()
    app.addHook('preHandler', async (req) => {
      req.ingest = { orgId }
    })
    await app.register(ingestRoutes, { storage, bus })
    return app
  }

  async function makeQueryApp(orgId: string) {
    const app = Fastify()
    app.addHook('preHandler', async (req) => {
      req.auth = { user: { id: 'u', email: 'e', orgId } }
    })
    await app.register(apiRoutes, { storage })
    return app
  }

  it('user A writes a trace; user B cannot see it in /api/sessions', async () => {
    const a = await createUser(db, {
      email: 'alice@example.com',
      passwordHash: await hashPassword('pwpwpwpw'),
      orgName: 'a-org',
    })
    const b = await createUser(db, {
      email: 'bob@example.com',
      passwordHash: await hashPassword('pwpwpwpw'),
      orgName: 'b-org',
    })

    const ingestA = await makeIngestApp(a.orgId)
    await ingestA.inject({
      method: 'POST',
      url: '/v1/traces',
      payload: payload('alice-project'),
    })
    await ingestA.close()

    const queryB = await makeQueryApp(b.orgId)
    const res = await queryB.inject({ method: 'GET', url: '/api/sessions' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ sessions: [] })
    await queryB.close()

    const queryA = await makeQueryApp(a.orgId)
    const ownRes = await queryA.inject({ method: 'GET', url: '/api/sessions' })
    expect((ownRes.json() as { sessions: unknown[] }).sessions).toHaveLength(1)
    await queryA.close()
  })

  it("user B with user A's session UUID still gets 404", async () => {
    const a = await createUser(db, {
      email: 'a@example.com',
      passwordHash: await hashPassword('pwpwpwpw'),
      orgName: 'a-org',
    })
    const b = await createUser(db, {
      email: 'b@example.com',
      passwordHash: await hashPassword('pwpwpwpw'),
      orgName: 'b-org',
    })

    const ingestA = await makeIngestApp(a.orgId)
    await ingestA.inject({ method: 'POST', url: '/v1/traces', payload: payload('p') })
    await ingestA.close()

    const queryA = await makeQueryApp(a.orgId)
    const aSessions = (await queryA
      .inject({ method: 'GET', url: '/api/sessions' })
      .then((r) => r.json())) as { sessions: Array<{ id: string }> }
    const stolenId = aSessions.sessions[0]!.id
    await queryA.close()

    const queryB = await makeQueryApp(b.orgId)
    const res = await queryB.inject({ method: 'GET', url: `/api/sessions/${stolenId}` })
    expect(res.statusCode).toBe(404)
    await queryB.close()
  })

  it("token created in org A can't be used to write to org B's data", async () => {
    const a = await createUser(db, {
      email: 'a@example.com',
      passwordHash: await hashPassword('pwpwpwpw'),
      orgName: 'a-org',
    })
    const created = await createTokenForProject(db, {
      orgId: a.orgId,
      projectName: 'a-proj',
      tokenName: 't',
    })

    // The token resolves to a's org. Even if the payload claims a different
    // project name, the ingest route overrides it to the token's project.
    const ingestApp = Fastify()
    ingestApp.addHook('preHandler', async (req) => {
      req.ingest = {
        orgId: created ? a.orgId : '',
        projectId: created.projectId,
        projectName: 'a-proj',
      }
    })
    await ingestApp.register(ingestRoutes, { storage, bus })

    await ingestApp.inject({
      method: 'POST',
      url: '/v1/traces',
      payload: payload('attempted-foreign-project'),
    })
    await ingestApp.close()

    // Verify the session lives under a-proj, not the attacker-claimed name.
    const queryA = await makeQueryApp(a.orgId)
    const list = (await queryA
      .inject({ method: 'GET', url: '/api/sessions' })
      .then((r) => r.json())) as { sessions: Array<{ projectName: string }> }
    expect(list.sessions[0]?.projectName).toBe('a-proj')
    await queryA.close()
  })
})
