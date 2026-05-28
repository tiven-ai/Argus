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
      const result = await deps.storage.writeTrace(trace)
      for (const stored of result.writtenSteps) {
        deps.bus.publish(`session:${result.sessionId}`, storedStepToApi(stored))
      }
      acceptedCount += result.writtenSteps.length
    }

    reply.code(200)
    return { accepted: acceptedCount }
  })
}
