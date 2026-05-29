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
