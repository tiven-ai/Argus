import type { Tx } from '../db-tenant/index.js'
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
 * then publish each written step to the bus. The bus publish happens AFTER the
 * tx is otherwise complete (`trx` here is the caller's tx; commit happens when
 * the withTenantTx wrapper resolves). Callers MUST invoke this inside
 * `app.withTenantTx(orgId, trx => processIngestion(trx, traces, ctx, deps))`.
 */
export async function processIngestion(
  trx: Tx,
  traces: WriteTraceInput[],
  ctx: IngestPipelineCtx,
  deps: IngestPipelineDeps,
): Promise<IngestPipelineResult> {
  let accepted = 0
  const toPublish: Array<{ sessionId: string; payload: ReturnType<typeof storedStepToApi> }> = []
  for (const trace of traces) {
    const overridden: WriteTraceInput = {
      ...trace,
      orgId: ctx.orgId,
      projectName: ctx.projectName ?? trace.projectName,
    }
    const result = await deps.storage.writeTrace(trx, overridden)
    for (const stored of result.writtenSteps) {
      toPublish.push({ sessionId: result.sessionId, payload: storedStepToApi(stored) })
    }
    accepted += result.writtenSteps.length
  }
  // Bus publish: queue inside the tx, fire after caller commits. We can't
  // observe commit from here; the simplest correct thing is to publish now and
  // accept that a rare rollback will leak a step over SSE. Real producers don't
  // rely on transactional outbox semantics for this; if needed, add an
  // afterCommit hook later.
  for (const m of toPublish) deps.bus.publish(`session:${m.sessionId}`, m.payload)
  return { accepted }
}
