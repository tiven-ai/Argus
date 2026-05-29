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
  includeDirs: [PROTO_ROOT] as string[],
}

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
