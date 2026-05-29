# Argus M5b — OTLP gRPC Ingest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an OTLP/gRPC trace ingest endpoint on port 4317 (the OTLP standard port). After this lands, both `POST /v1/traces` (HTTP/JSON) and `TraceService.Export` (gRPC) write to the same storage with identical semantics, including the M4 token-bearer auth in multi-tenant mode.

**Architecture:** Vendor the four OpenTelemetry proto files into `apps/server/proto/` and load them at runtime with `@grpc/proto-loader`. The proto-loader options (`longs: String`, `enums: Number`, `bytes: String`, `defaults: false`, `keepCase: false`) emit JS objects whose shape matches the existing `otlpExportRequestSchema` Zod definition — so the gRPC handler can pass the decoded request straight through `parseOtlpRequest` with no normalizer layer. A new `processIngestion(traces, ingestCtx, deps)` helper is extracted from the HTTP route so both surfaces share one code path for write + publish. Auth: gRPC reads the bearer token from `authorization` metadata (the standard OTLP/gRPC auth field) and runs it through the same `resolveTokenContext` used by HTTP.

**Tech Stack additions:** `@grpc/grpc-js` ^1.12 (the server runtime), `@grpc/proto-loader` ^0.7 (proto file → JS service definition). Both are Google's official Node gRPC libs, MIT-licensed.

**Scope deliberately excluded:**

- OTLP/HTTP-Protobuf body shape (different content-type on the HTTP endpoint; gRPC covers protobuf wire format)
- Server reflection (`grpc.reflection.v1alpha.ServerReflection`) — useful for ad-hoc inspection but not needed for OTel SDK clients
- TLS on the gRPC port (insecure cleartext, matching the HTTP side; production deployments terminate TLS at a proxy)
- gRPC compression (off by default; SDKs negotiate)

**Reference spec:** [docs/superpowers/specs/2026-05-28-argus-design.md](../specs/2026-05-28-argus-design.md) — M5 spec point: "OTLP gRPC 接收器 (:4317)".

---

## File Structure (after this plan)

```
apps/server/
├── package.json                                       (MODIFIED: +@grpc/grpc-js, @grpc/proto-loader)
├── proto/                                             (NEW: vendored OTel protos)
│   └── opentelemetry/proto/
│       ├── common/v1/common.proto
│       ├── resource/v1/resource.proto
│       ├── trace/v1/trace.proto
│       └── collector/trace/v1/trace_service.proto
├── src/
│   ├── env.ts                                         (MODIFIED: +GRPC_PORT)
│   ├── main.ts                                        (MODIFIED: pass grpcPort)
│   ├── server.ts                                      (MODIFIED: start gRPC alongside HTTP)
│   └── modules/
│       ├── ingest/
│       │   ├── pipeline.ts                            (NEW: shared processIngestion helper)
│       │   ├── routes.ts                              (MODIFIED: call pipeline)
│       │   └── index.ts                               (MODIFIED: re-export pipeline)
│       └── ingest-grpc/                               (NEW module)
│           ├── index.ts
│           ├── proto-loader.ts                        (loads proto, returns package definition)
│           ├── metadata-auth.ts                       (parses authorization metadata → ingest ctx)
│           ├── server.ts                              (createGrpcServer factory)
│           └── service.ts                             (TraceService.Export handler)
└── test/
    ├── ingest/
    │   └── pipeline.test.ts                           (NEW: pipeline-level test)
    └── ingest-grpc/
        ├── metadata-auth.test.ts                      (NEW)
        └── grpc-integration.test.ts                   (NEW: end-to-end via real grpc client)
```

---

## Common Conventions

- gRPC port defaults to 4317 (OTLP standard). Set `GRPC_PORT=0` to disable.
- All gRPC handlers use the same `IngestContext` shape (`{ orgId, projectId?, projectName? }`) as the HTTP route's `request.ingest`.
- Decoded protobuf objects use camelCase field names (matches Zod schema) — `keepCase: false` in proto-loader.
- Trace/span IDs arrive as base64 strings via gRPC; parser already accepts both base64 and hex (since M1).
- Commit messages: Conventional Commits, lowercase subject (commitlint enforces).
- Test count after this plan: 78 (M5a baseline) + new metadata-auth tests + new pipeline test + integration test.

---

## Task 1: Vendor OTel proto files + add gRPC deps

**Files:**

- Modify: `apps/server/package.json`
- Create: `apps/server/proto/opentelemetry/proto/common/v1/common.proto`
- Create: `apps/server/proto/opentelemetry/proto/resource/v1/resource.proto`
- Create: `apps/server/proto/opentelemetry/proto/trace/v1/trace.proto`
- Create: `apps/server/proto/opentelemetry/proto/collector/trace/v1/trace_service.proto`

### Step 1: Add deps to `apps/server/package.json`

Modify the `dependencies` block (alphabetical) to add `@grpc/grpc-js` and `@grpc/proto-loader`. The final dependencies block:

```json
  "dependencies": {
    "@argus/shared-types": "workspace:*",
    "@fastify/cookie": "^11.0.0",
    "@grpc/grpc-js": "^1.12.0",
    "@grpc/proto-loader": "^0.7.13",
    "bcryptjs": "^2.4.3",
    "fastify": "^5.0.0",
    "jsonwebtoken": "^9.0.0",
    "kysely": "^0.27.0",
    "pg": "^8.13.0",
    "zod": "^3.23.0"
  },
```

Run:

```bash
pnpm install
```

### Step 2: Download proto files from opentelemetry-proto v1.3.2

```bash
mkdir -p apps/server/proto/opentelemetry/proto/common/v1
mkdir -p apps/server/proto/opentelemetry/proto/resource/v1
mkdir -p apps/server/proto/opentelemetry/proto/trace/v1
mkdir -p apps/server/proto/opentelemetry/proto/collector/trace/v1

BASE='https://raw.githubusercontent.com/open-telemetry/opentelemetry-proto/v1.3.2/opentelemetry/proto'

curl -sf "$BASE/common/v1/common.proto" -o apps/server/proto/opentelemetry/proto/common/v1/common.proto
curl -sf "$BASE/resource/v1/resource.proto" -o apps/server/proto/opentelemetry/proto/resource/v1/resource.proto
curl -sf "$BASE/trace/v1/trace.proto" -o apps/server/proto/opentelemetry/proto/trace/v1/trace.proto
curl -sf "$BASE/collector/trace/v1/trace_service.proto" -o apps/server/proto/opentelemetry/proto/collector/trace/v1/trace_service.proto
```

### Step 3: Sanity-check the vendored protos

```bash
ls -la apps/server/proto/opentelemetry/proto/common/v1/common.proto \
       apps/server/proto/opentelemetry/proto/resource/v1/resource.proto \
       apps/server/proto/opentelemetry/proto/trace/v1/trace.proto \
       apps/server/proto/opentelemetry/proto/collector/trace/v1/trace_service.proto

# Verify each file has content and starts with `syntax = "proto3";`
for f in apps/server/proto/opentelemetry/proto/common/v1/common.proto \
         apps/server/proto/opentelemetry/proto/resource/v1/resource.proto \
         apps/server/proto/opentelemetry/proto/trace/v1/trace.proto \
         apps/server/proto/opentelemetry/proto/collector/trace/v1/trace_service.proto; do
  head -1 "$f"
done
```

Expected: each file's first line is `syntax = "proto3";`.

### Step 4: Update `apps/server/tsconfig.build.json` to exclude protos

The `proto/` directory should not be touched by tsc (.proto files aren't TypeScript). The tsconfig already only includes `src/**/*` so this is a no-op, but verify:

```bash
grep -n '"include"' apps/server/tsconfig.build.json apps/server/tsconfig.json
```

Expected: includes are `src/**/*` only — proto dir is naturally excluded.

### Step 5: Commit

```bash
git add apps/server/package.json apps/server/proto pnpm-lock.yaml
git commit -m "feat(server): vendor otel proto files + grpc-js/proto-loader deps"
```

---

## Task 2: Extract shared ingestion pipeline

**Files:**

- Create: `apps/server/src/modules/ingest/pipeline.ts`
- Modify: `apps/server/src/modules/ingest/routes.ts`
- Modify: `apps/server/src/modules/ingest/index.ts`
- Create: `apps/server/test/ingest/pipeline.test.ts`

This refactors the HTTP route's body — parse + write + publish — into a reusable `processIngestion` helper so the gRPC handler can use it identically.

### Step 1: Create `apps/server/src/modules/ingest/pipeline.ts`

```ts
import type { MessageBus } from '../pubsub/types.js'
import type { StorageBackend, WriteTraceInput } from '../storage/types.js'
import { storedStepToApi } from '../api/mappers.js'

export interface IngestPipelineDeps {
  storage: StorageBackend
  bus: MessageBus
}

export interface IngestPipelineCtx {
  orgId: string
  projectId?: string
  projectName?: string
}

export interface IngestPipelineResult {
  accepted: number
}

/**
 * Write each parsed trace to storage with the caller's orgId stamped onto it,
 * then publish each written step to the bus. Returns the total step count.
 *
 * If the caller's ingest context pins a specific projectName (i.e. the bearer
 * token was bound to a project), that name overrides whatever the OTLP payload
 * claimed — clients can't write to projects outside their token's scope.
 */
export async function processIngestion(
  traces: WriteTraceInput[],
  ctx: IngestPipelineCtx,
  deps: IngestPipelineDeps,
): Promise<IngestPipelineResult> {
  let accepted = 0
  for (const trace of traces) {
    const overridden: WriteTraceInput = {
      ...trace,
      orgId: ctx.orgId,
      projectName: ctx.projectName ?? trace.projectName,
    }
    const result = await deps.storage.writeTrace(overridden)
    for (const stored of result.writtenSteps) {
      deps.bus.publish(`session:${result.sessionId}`, storedStepToApi(stored))
    }
    accepted += result.writtenSteps.length
  }
  return { accepted }
}
```

### Step 2: Modify `apps/server/src/modules/ingest/routes.ts` to call the pipeline

Replace the file's content with:

```ts
import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import type { StorageBackend } from '../storage/types.js'
import type { MessageBus } from '../pubsub/types.js'
import { OtlpParseError, parseOtlpRequest } from './parser.js'
import { otlpExportRequestSchema } from './otlp-json.js'
import { processIngestion } from './pipeline.js'

export interface IngestRoutesDeps {
  storage: StorageBackend
  bus: MessageBus
}

export const ingestRoutes: FastifyPluginAsync<IngestRoutesDeps> = async (
  app: FastifyInstance,
  deps,
) => {
  app.post('/v1/traces', async (request, reply) => {
    const ingest = request.ingest
    if (!ingest) {
      reply.code(401)
      return { error: 'unauthenticated' }
    }

    const parseResult = otlpExportRequestSchema.safeParse(request.body)
    if (!parseResult.success) {
      reply.code(400)
      return { error: 'invalid_otlp_payload', issues: parseResult.error.issues }
    }

    let traces
    try {
      traces = parseOtlpRequest(parseResult.data)
    } catch (err) {
      if (err instanceof OtlpParseError) {
        reply.code(400)
        return { error: 'invalid_otlp_payload', message: err.message }
      }
      throw err
    }

    const { accepted } = await processIngestion(traces, ingest, deps)
    reply.code(200)
    return { accepted }
  })
}
```

### Step 3: Modify `apps/server/src/modules/ingest/index.ts` to re-export the pipeline

```ts
export { parseOtlpRequest, OtlpParseError } from './parser.js'
export { DEFAULT_ORG_ID } from '../../constants.js'
export { otlpExportRequestSchema, type OtlpExportRequest } from './otlp-json.js'
export { ingestRoutes } from './routes.js'
export {
  processIngestion,
  type IngestPipelineDeps,
  type IngestPipelineCtx,
  type IngestPipelineResult,
} from './pipeline.js'
```

### Step 4: Create `apps/server/test/ingest/pipeline.test.ts`

This is a small integration test that uses the real PG (already wired by the existing testcontainers setup) and confirms the pipeline writes + publishes correctly.

```ts
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

    // Subscribe to the deterministic channel name (we know the session won't
    // exist yet, so we subscribe to a wildcard via emitter inspection? — simpler:
    // run the pipeline first, then read sessions to find the new sessionId, then
    // verify the bus event was emitted by counting via a second subscription).
    // Instead: subscribe right before publish by capturing all session:* via
    // intercepting publish. We use bus.subscribe per known sessionId after the
    // write happens — so we test through a different invariant: the storage
    // received the write and the bus published exactly one event of correct shape.

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
```

### Step 5: Run all server tests, confirm pass

```bash
pnpm --filter @argus/server test
```

Expected: existing 64 tests still pass + 2 new pipeline tests = 66 total.

### Step 6: Commit

```bash
git add apps/server/src/modules/ingest apps/server/test/ingest/pipeline.test.ts
git commit -m "refactor(server): extract shared processIngestion pipeline + tests"
```

---

## Task 3: gRPC metadata auth helper + tests

**Files:**

- Create: `apps/server/src/modules/ingest-grpc/metadata-auth.ts`
- Create: `apps/server/test/ingest-grpc/metadata-auth.test.ts`

### Step 1: Write the failing test `apps/server/test/ingest-grpc/metadata-auth.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import * as grpc from '@grpc/grpc-js'
import { extractBearerToken } from '../../src/modules/ingest-grpc/metadata-auth.js'

describe('extractBearerToken', () => {
  it('returns the token from an "authorization: Bearer <token>" metadata entry', () => {
    const md = new grpc.Metadata()
    md.add('authorization', 'Bearer argus_abc123')
    expect(extractBearerToken(md)).toBe('argus_abc123')
  })

  it('is case-insensitive on the Bearer keyword', () => {
    const md = new grpc.Metadata()
    md.add('authorization', 'bearer argus_lower')
    expect(extractBearerToken(md)).toBe('argus_lower')
  })

  it('reads from "authorization" first, then falls back to "x-argus-token"', () => {
    const md = new grpc.Metadata()
    md.add('x-argus-token', 'argus_fromcustom')
    expect(extractBearerToken(md)).toBe('argus_fromcustom')

    const md2 = new grpc.Metadata()
    md2.add('authorization', 'Bearer argus_fromauth')
    md2.add('x-argus-token', 'argus_fromcustom')
    expect(extractBearerToken(md2)).toBe('argus_fromauth')
  })

  it('returns null when no token is present', () => {
    expect(extractBearerToken(new grpc.Metadata())).toBeNull()
  })

  it('returns null for an authorization header that is not Bearer', () => {
    const md = new grpc.Metadata()
    md.add('authorization', 'Basic dXNlcjpwYXNz')
    expect(extractBearerToken(md)).toBeNull()
  })
})
```

### Step 2: Run, confirm FAIL

```bash
pnpm --filter @argus/server test
```

Expected: FAIL — `Cannot find module '.../ingest-grpc/metadata-auth.js'`.

### Step 3: Create `apps/server/src/modules/ingest-grpc/metadata-auth.ts`

```ts
import type * as grpc from '@grpc/grpc-js'

/**
 * Extract a bearer token from gRPC call metadata.
 *
 * Priority:
 *   1. `authorization: Bearer <token>`  (the OTLP/gRPC standard)
 *   2. `x-argus-token: <token>`         (Argus-specific fallback for clients
 *                                        that can't set Authorization in metadata,
 *                                        e.g. some browser-side gRPC-Web setups)
 *
 * Returns null when no usable token is present.
 */
export function extractBearerToken(metadata: grpc.Metadata): string | null {
  const authValues = metadata.get('authorization')
  for (const raw of authValues) {
    const value = String(raw).trim()
    const m = /^Bearer\s+(.+)$/i.exec(value)
    if (m && m[1]) return m[1].trim()
  }

  const customValues = metadata.get('x-argus-token')
  for (const raw of customValues) {
    const value = String(raw).trim()
    if (value.length > 0) return value
  }

  return null
}
```

### Step 4: Run, confirm PASS

```bash
pnpm --filter @argus/server test
```

Expected: 5 new tests pass; total 71 (66 + 5).

### Step 5: Commit

```bash
git add apps/server/src/modules/ingest-grpc/metadata-auth.ts apps/server/test/ingest-grpc/metadata-auth.test.ts
git commit -m "feat(server): grpc metadata bearer token extractor + tests"
```

---

## Task 4: gRPC server + TraceService implementation

**Files:**

- Create: `apps/server/src/modules/ingest-grpc/proto-loader.ts`
- Create: `apps/server/src/modules/ingest-grpc/service.ts`
- Create: `apps/server/src/modules/ingest-grpc/server.ts`
- Create: `apps/server/src/modules/ingest-grpc/index.ts`

### Step 1: Create `apps/server/src/modules/ingest-grpc/proto-loader.ts`

```ts
import * as grpc from '@grpc/grpc-js'
import { loadSync } from '@grpc/proto-loader'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Repo path to the vendored OTel proto directory. From this module's compiled
 * location, two parents up (modules/ingest-grpc/) plus three more (src/, server/,
 * apps/) lands at the package root; then `proto/` is the vendored tree.
 */
const PROTO_ROOT = path.resolve(dirname, '../../../proto')
const ENTRY_PROTO = 'opentelemetry/proto/collector/trace/v1/trace_service.proto'

const PROTO_LOADER_OPTIONS = {
  keepCase: false, // snake_case → camelCase (matches our Zod schema)
  longs: String, // int64 / uint64 → string
  enums: Number, // enum values as numbers (our parser handles 0/1/2)
  defaults: false, // only set fields appear (critical for AnyValue oneof)
  oneofs: false, // no virtual `oneof` discriminator field
  bytes: String, // bytes (trace_id, span_id) → base64 string (parser accepts both)
  includeDirs: [PROTO_ROOT],
} as const

export interface OtlpGrpcProto {
  TraceService: grpc.ServiceClientConstructor
  /** The descriptor block used to register handlers on a grpc.Server. */
  traceServiceDefinition: grpc.ServiceDefinition
}

let cached: OtlpGrpcProto | null = null

export function loadOtlpProto(): OtlpGrpcProto {
  if (cached) return cached
  const packageDefinition = loadSync(ENTRY_PROTO, PROTO_LOADER_OPTIONS)
  const loaded = grpc.loadPackageDefinition(packageDefinition) as unknown as {
    opentelemetry: {
      proto: {
        collector: {
          trace: {
            v1: {
              TraceService: grpc.ServiceClientConstructor
            }
          }
        }
      }
    }
  }
  const TraceService = loaded.opentelemetry.proto.collector.trace.v1.TraceService
  cached = {
    TraceService,
    traceServiceDefinition: TraceService.service,
  }
  return cached
}
```

### Step 2: Create `apps/server/src/modules/ingest-grpc/service.ts`

```ts
import * as grpc from '@grpc/grpc-js'
import type { Kysely } from 'kysely'
import type { DB } from '../../db/schema.js'
import type { MessageBus } from '../pubsub/types.js'
import type { StorageBackend } from '../storage/types.js'
import {
  OtlpParseError,
  otlpExportRequestSchema,
  parseOtlpRequest,
  processIngestion,
} from '../ingest/index.js'
import { DEFAULT_ORG_ID } from '../../constants.js'
import { resolveTokenContext } from '../tokens/index.js'
import { extractBearerToken } from './metadata-auth.js'

export interface TraceServiceDeps {
  db: Kysely<DB>
  storage: StorageBackend
  bus: MessageBus
  mode: 'local' | 'multi-tenant'
}

interface ExportRequest {
  resourceSpans?: unknown
}

interface ExportResponse {
  partialSuccess?: {
    rejectedSpans: string
    errorMessage: string
  }
}

/**
 * Implements the OTLP `TraceService.Export` RPC. Auth + body parse + write are
 * the same as the HTTP route — they share `processIngestion`.
 */
export function makeTraceServiceHandlers(deps: TraceServiceDeps): {
  Export: grpc.handleUnaryCall<ExportRequest, ExportResponse>
} {
  return {
    Export: async (call, callback) => {
      try {
        // ---- Auth ----
        let orgId = DEFAULT_ORG_ID
        let projectId: string | undefined
        let projectName: string | undefined

        if (deps.mode === 'multi-tenant') {
          const token = extractBearerToken(call.metadata)
          if (!token) {
            callback({
              code: grpc.status.UNAUTHENTICATED,
              message: 'missing_ingest_token',
            })
            return
          }
          const ctx = await resolveTokenContext(deps.db, token)
          if (!ctx) {
            callback({
              code: grpc.status.UNAUTHENTICATED,
              message: 'invalid_ingest_token',
            })
            return
          }
          orgId = ctx.orgId
          projectId = ctx.projectId
          projectName = ctx.projectName
        }

        // ---- Parse ----
        const parsed = otlpExportRequestSchema.safeParse(call.request)
        if (!parsed.success) {
          callback({
            code: grpc.status.INVALID_ARGUMENT,
            message: `invalid_otlp_payload: ${parsed.error.issues[0]?.message ?? 'schema mismatch'}`,
          })
          return
        }

        let traces
        try {
          traces = parseOtlpRequest(parsed.data)
        } catch (err) {
          if (err instanceof OtlpParseError) {
            callback({
              code: grpc.status.INVALID_ARGUMENT,
              message: err.message,
            })
            return
          }
          throw err
        }

        // ---- Write + publish ----
        await processIngestion(
          traces,
          { orgId, projectId, projectName },
          { storage: deps.storage, bus: deps.bus },
        )

        callback(null, {})
      } catch (err) {
        callback({
          code: grpc.status.INTERNAL,
          message: (err as Error).message,
        })
      }
    },
  }
}
```

### Step 3: Create `apps/server/src/modules/ingest-grpc/server.ts`

```ts
import * as grpc from '@grpc/grpc-js'
import { loadOtlpProto } from './proto-loader.js'
import { makeTraceServiceHandlers, type TraceServiceDeps } from './service.js'

export interface CreateGrpcServerOptions extends TraceServiceDeps {
  host: string
  port: number
}

export interface StartedGrpcServer {
  server: grpc.Server
  /** Actual port bound — useful when port=0 (random). */
  port: number
  /** Convenience for tests/teardown. */
  close(): Promise<void>
}

export async function startGrpcServer(opts: CreateGrpcServerOptions): Promise<StartedGrpcServer> {
  const { traceServiceDefinition } = loadOtlpProto()
  const server = new grpc.Server()
  const handlers = makeTraceServiceHandlers(opts)
  // @ts-expect-error grpc-js uses loose handler typing; the shape is right.
  server.addService(traceServiceDefinition, handlers)

  const port = await new Promise<number>((resolve, reject) => {
    server.bindAsync(
      `${opts.host}:${opts.port}`,
      grpc.ServerCredentials.createInsecure(),
      (err, boundPort) => {
        if (err) reject(err)
        else resolve(boundPort)
      },
    )
  })

  return {
    server,
    port,
    close: () =>
      new Promise<void>((resolve) => {
        server.tryShutdown(() => resolve())
      }),
  }
}
```

### Step 4: Create `apps/server/src/modules/ingest-grpc/index.ts`

```ts
export { extractBearerToken } from './metadata-auth.js'
export { loadOtlpProto } from './proto-loader.js'
export { makeTraceServiceHandlers } from './service.js'
export type { TraceServiceDeps } from './service.js'
export { startGrpcServer } from './server.js'
export type { CreateGrpcServerOptions, StartedGrpcServer } from './server.js'
```

### Step 5: Typecheck (the gRPC code needs to compile)

```bash
pnpm --filter @argus/server typecheck
```

Expected: 0 errors.

### Step 6: Commit

```bash
git add apps/server/src/modules/ingest-grpc
git commit -m "feat(server): grpc trace service + proto loader + server factory"
```

---

## Task 5: Wire gRPC into createServer + env GRPC_PORT + main

**Files:**

- Modify: `apps/server/src/env.ts`
- Modify: `apps/server/src/server.ts`
- Modify: `apps/server/src/main.ts`

### Step 1: Modify `apps/server/src/env.ts` — add `GRPC_PORT`

Replace the schema with:

```ts
import { z } from 'zod'

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().url(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  ARGUS_MODE: z.enum(['local', 'multi-tenant']).default('local'),
  JWT_SECRET: z.string().min(32).default('local-dev-secret-not-for-production-x'),
  COOKIE_NAME: z.string().default('argus_session'),
  // GRPC_PORT=0 disables the gRPC ingest server entirely. Default 4317 is the
  // OTLP standard.
  GRPC_PORT: z.coerce.number().int().min(0).default(4317),
})

export type Env = z.infer<typeof envSchema>

export function loadEnv(env: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(env)
}
```

### Step 2: Modify `apps/server/src/server.ts` — return optional grpcServer in `ArgusServer`, but DON'T start it here

Reason: the HTTP and gRPC servers have independent lifecycles, and tests want fine-grained control. We expose helpers but main.ts orchestrates them.

Open the file. Find the `ArgusServer` interface and keep it unchanged:

```ts
export interface ArgusServer {
  app: FastifyInstance
  db: Kysely<DB>
  bus: MessageBus
}
```

No change needed in this file — the gRPC server is started separately in main.ts. (Keep server.ts focused on the HTTP/Fastify side.)

### Step 3: Replace `apps/server/src/main.ts`

```ts
import { loadEnv } from './env.js'
import { createServer } from './server.js'
import { startGrpcServer, type StartedGrpcServer } from './modules/ingest-grpc/index.js'

async function main() {
  const env = loadEnv()
  const { app, db, bus } = await createServer({
    databaseUrl: env.DATABASE_URL,
    logLevel: env.LOG_LEVEL,
    mode: env.ARGUS_MODE,
    jwtSecret: env.JWT_SECRET,
    cookieName: env.COOKIE_NAME,
  })

  await app.listen({ port: env.PORT, host: env.HOST })
  app.log.info(`Argus HTTP server listening on http://${env.HOST}:${env.PORT}`)

  // We need access to the storage/db/bus to wire the gRPC service. createServer
  // already constructed PgStorage from db. We pass the same db + a fresh
  // PgStorage in here (it's a thin wrapper, instantiating twice is fine), so we
  // don't have to widen createServer's return shape.
  let grpc: StartedGrpcServer | undefined
  if (env.GRPC_PORT > 0) {
    const { PgStorage } = await import('./modules/storage/pg.js')
    grpc = await startGrpcServer({
      host: env.HOST,
      port: env.GRPC_PORT,
      db,
      storage: new PgStorage(db),
      bus,
      mode: env.ARGUS_MODE,
    })
    app.log.info(`Argus gRPC server listening on ${env.HOST}:${grpc.port}`)
  } else {
    app.log.info('Argus gRPC server disabled (GRPC_PORT=0)')
  }

  // Graceful shutdown so both servers close on SIGTERM.
  const shutdown = async () => {
    app.log.info('Shutting down…')
    await Promise.all([app.close(), grpc?.close() ?? Promise.resolve()])
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
```

### Step 4: Typecheck + run existing tests (no behaviour change yet — gRPC isn't invoked by any test)

```bash
pnpm --filter @argus/server typecheck
pnpm --filter @argus/server test
```

Expected: typecheck 0 errors. Test count unchanged from Task 3: 71 tests pass.

### Step 5: Commit

```bash
git add apps/server/src/env.ts apps/server/src/main.ts
git commit -m "feat(server): wire grpc ingest server into main + GRPC_PORT env"
```

---

## Task 6: End-to-end gRPC integration test

**Files:**

- Create: `apps/server/test/ingest-grpc/grpc-integration.test.ts`

This is the headline test. It starts a real gRPC server on a random port, opens a real gRPC client, calls `TraceService.Export` with a protobuf payload, and verifies the storage layer received the write.

### Step 1: Create the test file

```ts
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
```

### Step 2: Run the test

```bash
pnpm --filter @argus/server test
```

Expected: 3 new grpc-integration tests pass. Total: 71 + 3 = **74 server tests**.

If the test hangs, the grpc server may not be tearing down cleanly. Verify `afterAll` calls `closeServer()` (the test does this via the shared variable).

### Step 3: Commit

```bash
git add apps/server/test/ingest-grpc/grpc-integration.test.ts
git commit -m "test(server): end-to-end grpc TraceService.Export integration"
```

---

## Task 7: Acceptance + tag

No new code. Verification + tagging.

### Step 1: Clean install + full pipeline

```bash
rm -rf node_modules apps/*/node_modules packages/*/node_modules
pnpm install
pnpm db:up
sleep 5
pnpm typecheck
pnpm lint
pnpm test
pnpm db:down
pnpm build
```

Expected: typecheck/lint/build all 0 errors. Tests: **74 server + 14 web = 88 total**.

### Step 2: Manual local-mode smoke via grpcurl (only if grpcurl is installed)

```bash
if command -v grpcurl >/dev/null; then
  pnpm db:up
  sleep 5
  docker exec argus-postgres psql -U argus -d argus -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
  pnpm db:migrate

  DATABASE_URL=postgres://argus:argus@localhost:5432/argus pnpm --filter @argus/server dev > /tmp/argus.log 2>&1 &
  PID=$!
  sleep 4

  grpcurl -plaintext \
    -import-path apps/server/proto \
    -proto opentelemetry/proto/collector/trace/v1/trace_service.proto \
    -d '{"resourceSpans":[{"resource":{"attributes":[{"key":"argus.project","value":{"stringValue":"grpcurl-test"}},{"key":"argus.service","value":{"stringValue":"smoke"}}]},"scopeSpans":[{"spans":[{"traceId":"AAAAAAAAAAAAAAAAAAAAAA==","spanId":"AAAAAAAAAAA=","name":"hello","startTimeUnixNano":"1779955200000000000","endTimeUnixNano":"1779955201000000000"}]}]}]}' \
    localhost:4317 opentelemetry.proto.collector.trace.v1.TraceService/Export

  echo "--- /api/sessions ---"
  curl -sf http://localhost:4000/api/sessions | python3 -m json.tool | head -20

  kill $PID 2>/dev/null
  wait $PID 2>/dev/null || true
  pnpm db:down
else
  echo "grpcurl not installed — skipping manual smoke (tests already cover the path end-to-end)"
fi
```

Expected (when grpcurl is present): the Export RPC returns `{}` and `/api/sessions` shows the freshly-ingested `grpcurl-test` session.

### Step 3: Tag + push

```bash
git tag -a m5b-grpc-ingest -m "M5b OTLP gRPC ingest complete

Adds a gRPC server on :4317 implementing TraceService.Export with the same
auth + storage + bus semantics as POST /v1/traces.

Acceptance:
- 88 tests pass (74 server + 14 web)
- vendored OTel protos v1.3.2; @grpc/grpc-js + @grpc/proto-loader added
- shared processIngestion pipeline used by both HTTP and gRPC paths
- end-to-end gRPC integration test (local + multi-tenant + token-scope override)
- GRPC_PORT env var (default 4317; set 0 to disable)
"
git push origin main
git push origin m5b-grpc-ingest
```

### Step 4: Confirm CI is green at https://github.com/tiven-ai/Argus/actions

---

## Acceptance Summary

M5b is complete when:

- [ ] `pnpm install` / `typecheck` / `lint` / `test` / `build` all exit 0
- [ ] 88 tests pass (74 server: M5a's 78 server portion was 64; +2 pipeline +5 metadata-auth +3 grpc-integration = 74; web stays at 14)
- [ ] OTel protos v1.3.2 vendored under `apps/server/proto/`
- [ ] `@grpc/grpc-js` and `@grpc/proto-loader` installed
- [ ] `processIngestion` shared between HTTP route and gRPC service
- [ ] gRPC server starts on `GRPC_PORT` (default 4317) when set > 0, disabled when 0
- [ ] Local-mode: gRPC client without auth writes to default org
- [ ] Multi-tenant: gRPC client without bearer gets `UNAUTHENTICATED`; with valid token writes to the token's project
- [ ] Token's project name overrides whatever the gRPC payload claims (same guard as HTTP)
- [ ] Tag `m5b-grpc-ingest` pushed; CI green

Once this lands, **M5 (gRPC ingest + DESIGN.md application) is fully complete.** Next milestones:

- M6 i18n (en/zh-CN/ja)
- post-M4 hardening (email verification, PG RLS, audit log)
- dark mode toggle (tokens already exist)
