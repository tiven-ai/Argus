import type { FastifyInstance, FastifyPluginAsync } from 'fastify'
import type { StorageBackend } from '../storage/types.js'
import type { MessageBus } from '../pubsub/types.js'
import { storedStepToApi } from '../api/mappers.js'
import { OtlpParseError, parseOtlpRequest } from './parser.js'
import { otlpExportRequestSchema } from './otlp-json.js'

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

    let acceptedCount = 0
    for (const trace of traces) {
      // Stamp orgId from the request context. If the token also pinned a
      // specific project, force the project name to match — clients can't write
      // to projects outside their token's scope.
      const overridden = {
        ...trace,
        orgId: ingest.orgId,
        projectName: ingest.projectName ?? trace.projectName,
      }
      const result = await deps.storage.writeTrace(overridden)
      for (const stored of result.writtenSteps) {
        deps.bus.publish(`session:${result.sessionId}`, storedStepToApi(stored))
      }
      acceptedCount += result.writtenSteps.length
    }

    reply.code(200)
    return { accepted: acceptedCount }
  })
}
