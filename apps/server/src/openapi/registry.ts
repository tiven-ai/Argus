import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'
import { ListSessionsResponseSchema, GetSessionResponseSchema } from '@argus/shared-types'
import { otlpExportRequestSchema } from '../modules/ingest/index.js'

// Adds .openapi() to the shared zod instance. Safe: server and shared-types
// resolve the SAME zod (pnpm-deduped), so imported schemas work too.
extendZodWithOpenApi(z)

/**
 * Build the OpenAPI 3 document for Argus's PUBLIC API surface.
 * Pure function — no filesystem, no server. The CLI serializes its output.
 *
 * Scope (see spec): ingest + read-only sessions + healthz. Auth/projects/tokens
 * (internal web-app API) and the SSE stream are intentionally excluded.
 */
export function buildOpenApiDocument(): ReturnType<OpenApiGeneratorV3['generateDocument']> {
  const registry = new OpenAPIRegistry()

  registry.registerPath({
    method: 'post',
    path: '/v1/traces',
    summary: 'Ingest OpenTelemetry traces (OTLP/HTTP-JSON)',
    request: {
      body: {
        required: true,
        content: { 'application/json': { schema: otlpExportRequestSchema } },
      },
    },
    responses: {
      200: {
        description: 'Accepted',
        content: { 'application/json': { schema: z.object({ accepted: z.number().int() }) } },
      },
      400: { description: 'Invalid OTLP payload' },
      401: { description: 'Unauthenticated (multi-tenant mode)' },
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/api/sessions',
    summary: 'List sessions, most recently started first',
    request: {
      query: z.object({
        limit: z.string().optional(),
        projectId: z.string().optional(),
      }),
    },
    responses: {
      200: {
        description: 'Session summaries',
        content: { 'application/json': { schema: ListSessionsResponseSchema } },
      },
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/api/sessions/{sessionId}',
    summary: 'Get one session with its steps',
    request: { params: z.object({ sessionId: z.string() }) },
    responses: {
      200: {
        description: 'Session detail',
        content: { 'application/json': { schema: GetSessionResponseSchema } },
      },
      404: { description: 'Not found' },
    },
  })

  registry.registerPath({
    method: 'get',
    path: '/healthz',
    summary: 'Liveness check',
    responses: {
      200: {
        description: 'OK',
        content: { 'application/json': { schema: z.object({ status: z.literal('ok') }) } },
      },
    },
  })

  return new OpenApiGeneratorV3(registry.definitions).generateDocument({
    openapi: '3.0.3',
    info: {
      title: 'Argus API',
      version: '0.0.0',
      description:
        'Public ingest and read-only session API. See docs/conventions/semantic-conventions.md.',
    },
    servers: [{ url: 'http://localhost:4000', description: 'Local dev' }],
  })
}
