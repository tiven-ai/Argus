import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import type { Kysely } from 'kysely'
import type { DB } from '../../src/db/schema.js'
import { dbTenantPlugin } from '../../src/modules/db-tenant/index.js'
import { projectRoutes } from '../../src/modules/projects/index.js'
import { createAppRoleTestDb, createTestDb, truncateAll } from '../helpers/db.js'

const ORG_A = '00000000-0000-0000-0000-0000000000aa'
const ORG_B = '00000000-0000-0000-0000-0000000000bb'

describe('GET /api/projects', () => {
  let appDb: Kysely<DB>
  let admin: Kysely<DB>
  let app: FastifyInstance
  let authedOrgId: string

  beforeAll(async () => {
    appDb = createAppRoleTestDb()
    admin = createTestDb()
    app = Fastify()
    await app.register(dbTenantPlugin, { db: appDb })
    app.addHook('preHandler', async (req) => {
      if (authedOrgId) {
        req.auth = { user: { id: 'u', email: 'e', orgId: authedOrgId, emailVerifiedAt: null } }
      }
    })
    await app.register(projectRoutes)
  })

  beforeEach(async () => {
    await truncateAll(admin)
    await admin
      .insertInto('orgs')
      .values([
        { id: ORG_A, name: 'org-a' },
        { id: ORG_B, name: 'org-b' },
      ])
      .execute()
  })

  afterAll(async () => {
    await app.close()
    await appDb.destroy()
    await admin.destroy()
  })

  async function seedProjects(orgId: string, names: string[]): Promise<void> {
    await admin
      .insertInto('projects')
      .values(names.map((name) => ({ org_id: orgId, name })))
      .execute()
  }

  it('returns 401 when unauthenticated', async () => {
    authedOrgId = ''
    const res = await app.inject({ method: 'GET', url: '/api/projects' })
    expect(res.statusCode).toBe(401)
  })

  it('lists the authed org projects ordered by name', async () => {
    authedOrgId = ORG_A
    await seedProjects(ORG_A, ['beta', 'alpha'])
    const res = await app.inject({ method: 'GET', url: '/api/projects' })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { projects: Array<{ id: string; name: string; createdAt: string }> }
    expect(body.projects.map((p) => p.name)).toEqual(['alpha', 'beta'])
    expect(typeof body.projects[0]!.id).toBe('string')
    expect(typeof body.projects[0]!.createdAt).toBe('string')
  })

  it('does not leak another org projects (tenant isolation)', async () => {
    authedOrgId = ORG_B
    await seedProjects(ORG_A, ['secret-a'])
    const res = await app.inject({ method: 'GET', url: '/api/projects' })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { projects: unknown[] }).projects).toHaveLength(0)
  })
})
