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
