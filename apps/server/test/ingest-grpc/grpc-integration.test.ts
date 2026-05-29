import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import * as grpc from '@grpc/grpc-js'
import { startGrpcServer, loadOtlpProto } from '../../src/modules/ingest-grpc/index.js'
import { PgStorage } from '../../src/modules/storage/pg.js'
import { InProcMessageBus } from '../../src/modules/pubsub/index.js'
import { createTestDb, truncateAll } from '../helpers/db.js'
import { createTokenForProject } from '../../src/modules/tokens/dao.js'
import { createUser } from '../../src/modules/auth/dao.js'
import { hashPassword } from '../../src/modules/auth/password.js'

const HEX_TRACE = '0123456789abcdef0123456789abcdef'
const HEX_SPAN = 'aaaaaaaaaaaaaaaa'

function makeExportRequest(projectName: string) {
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
                traceId: Buffer.from(HEX_TRACE, 'hex'),
                spanId: Buffer.from(HEX_SPAN, 'hex'),
                name: 'grpc.span',
                kind: 1,
                startTimeUnixNano: '1779955200000000000',
                endTimeUnixNano: '1779955201000000000',
                attributes: [],
                events: [],
                status: { code: 1, message: '' },
              },
            ],
          },
        ],
      },
    ],
  }
}

describe('gRPC TraceService.Export end-to-end', () => {
  const db = createTestDb()
  const storage = new PgStorage(db)
  const bus = new InProcMessageBus()

  let serverPort: number
  let closeServer: () => Promise<void>

  beforeEach(async () => {
    await truncateAll(db)
  })

  afterAll(async () => {
    await closeServer?.()
    await db.destroy()
  })

  function makeClient(port: number, metadata?: grpc.Metadata) {
    const { TraceService } = loadOtlpProto()
    const client = new TraceService(`127.0.0.1:${port}`, grpc.credentials.createInsecure())
    return {
      client,
      export: (req: unknown) =>
        new Promise<unknown>((resolve, reject) => {
          const cb = (err: grpc.ServiceError | null, response: unknown) => {
            if (err) reject(err)
            else resolve(response)
          }
          if (metadata) {
            ;(
              client as unknown as { Export: (r: unknown, m: grpc.Metadata, c: typeof cb) => void }
            ).Export(req, metadata, cb)
          } else {
            ;(client as unknown as { Export: (r: unknown, c: typeof cb) => void }).Export(req, cb)
          }
        }),
      close: () => {
        client.close()
      },
    }
  }

  it('local mode: client without auth metadata writes to the default org', async () => {
    const started = await startGrpcServer({
      host: '127.0.0.1',
      port: 0,
      db,
      storage,
      bus,
      mode: 'local',
    })
    serverPort = started.port
    closeServer = started.close

    const c = makeClient(started.port)
    const response = await c.export(makeExportRequest('grpc-demo'))
    expect(response).toBeDefined()

    const sessions = await storage.listSessions({
      orgId: '00000000-0000-0000-0000-000000000000',
    })
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.projectName).toBe('grpc-demo')
    expect(sessions[0]?.traceId).toBe(HEX_TRACE)

    c.close()
  }, 15_000)

  it('multi-tenant mode: rejects an Export without bearer metadata', async () => {
    const started = await startGrpcServer({
      host: '127.0.0.1',
      port: 0,
      db,
      storage,
      bus,
      mode: 'multi-tenant',
    })
    closeServer = started.close

    const c = makeClient(started.port)
    await expect(c.export(makeExportRequest('p'))).rejects.toMatchObject({
      code: grpc.status.UNAUTHENTICATED,
    })

    c.close()
  }, 15_000)

  it('multi-tenant mode: accepts a valid bearer token and writes to its org', async () => {
    const user = await createUser(db, {
      email: 'g@example.com',
      passwordHash: await hashPassword('pwpwpwpw'),
      orgName: 'g-org',
    })
    const created = await createTokenForProject(db, {
      orgId: user.orgId,
      projectName: 'g-proj',
      tokenName: 'grpc',
    })

    const started = await startGrpcServer({
      host: '127.0.0.1',
      port: 0,
      db,
      storage,
      bus,
      mode: 'multi-tenant',
    })
    closeServer = started.close

    const md = new grpc.Metadata()
    md.add('authorization', `Bearer ${created.token}`)
    const c = makeClient(started.port, md)

    const response = await c.export(makeExportRequest('attacker-claimed'))
    expect(response).toBeDefined()

    const list = await storage.listSessions({ orgId: user.orgId })
    expect(list).toHaveLength(1)
    // Token's project name overrides the attacker-claimed one.
    expect(list[0]?.projectName).toBe('g-proj')

    c.close()
  }, 15_000)
})
