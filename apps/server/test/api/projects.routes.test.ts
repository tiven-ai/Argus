import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import type { Kysely } from 'kysely'
import type { DB } from '../../src/db/schema.js'
import { dbTenantPlugin } from '../../src/modules/db-tenant/index.js'
import { projectRoutes } from '../../src/modules/projects/index.js'
import { PgStorage } from '../../src/modules/storage/pg.js'
import { createAppRoleTestDb, createTestDb, truncateAll } from '../helpers/db.js'

const ORG_A = '00000000-0000-0000-0000-0000000000aa'
const ORG_B = '00000000-0000-0000-0000-0000000000bb'

describe('project routes', () => {
  let appDb: Kysely<DB>
  let admin: Kysely<DB>
  let app: FastifyInstance
  let authedOrgId: string
  const storage = new PgStorage()

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

  it('POST /api/projects creates a project and audits', async () => {
    authedOrgId = ORG_A
    const res = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: 'alpha' },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { project: { id: string; name: string; createdAt: string } }
    expect(body.project.name).toBe('alpha')
    expect(typeof body.project.id).toBe('string')

    const audit = await admin
      .selectFrom('audit_log')
      .selectAll()
      .where('org_id', '=', ORG_A)
      .where('event_type', '=', 'project_create')
      .execute()
    expect(audit).toHaveLength(1)
    expect(audit[0]?.target_kind).toBe('project')
    expect(audit[0]?.target_id).toBe(body.project.id)
    expect(audit[0]?.metadata).toEqual({ name: 'alpha' })
  })

  it('POST /api/projects rejects an empty name with 400', async () => {
    authedOrgId = ORG_A
    const res = await app.inject({ method: 'POST', url: '/api/projects', payload: { name: '' } })
    expect(res.statusCode).toBe(400)
  })

  it('POST /api/projects returns 409 on a duplicate name', async () => {
    authedOrgId = ORG_A
    await seedProjects(ORG_A, ['dup'])
    const res = await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'dup' } })
    expect(res.statusCode).toBe(409)
  })

  it('POST /api/projects returns 401 without auth', async () => {
    authedOrgId = ''
    const res = await app.inject({ method: 'POST', url: '/api/projects', payload: { name: 'x' } })
    expect(res.statusCode).toBe(401)
  })

  it('PATCH /api/projects/:id renames and audits', async () => {
    authedOrgId = ORG_A
    const created = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: 'old' },
    })
    const id = (created.json() as { project: { id: string } }).project.id

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${id}`,
      payload: { name: 'new' },
    })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { project: { name: string } }).project.name).toBe('new')

    const audit = await admin
      .selectFrom('audit_log')
      .selectAll()
      .where('org_id', '=', ORG_A)
      .where('event_type', '=', 'project_rename')
      .execute()
    expect(audit).toHaveLength(1)
    expect(audit[0]?.target_id).toBe(id)
    expect(audit[0]?.metadata).toEqual({ name: 'new' })
  })

  it('PATCH /api/projects/:id returns 409 when renaming to an existing name', async () => {
    authedOrgId = ORG_A
    await seedProjects(ORG_A, ['taken'])
    const created = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: 'mine' },
    })
    const id = (created.json() as { project: { id: string } }).project.id
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${id}`,
      payload: { name: 'taken' },
    })
    expect(res.statusCode).toBe(409)
  })

  it('PATCH /api/projects/:id returns 404 for an unknown id', async () => {
    authedOrgId = ORG_A
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/projects/00000000-0000-0000-0000-0000000000ff',
      payload: { name: 'whatever' },
    })
    expect(res.statusCode).toBe(404)
  })
})
