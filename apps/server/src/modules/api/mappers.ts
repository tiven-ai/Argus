import type { Step, StepEvent } from '@argus/shared-types'
import type { StoredStep, StoredStepEvent } from '../storage/types.js'

export function storedEventToApi(e: StoredStepEvent): StepEvent {
  return {
    id: e.id,
    name: e.name,
    ts: e.ts.toISOString(),
    attributes: e.attributes,
  }
}

export function storedStepToApi(step: StoredStep): Step {
  return {
    id: step.id,
    spanId: step.spanId,
    parentSpanId: step.parentSpanId,
    name: step.name,
    kind: step.kind,
    componentType: step.componentType,
    componentName: step.componentName,
    startedAt: step.startedAt.toISOString(),
    endedAt: step.endedAt.toISOString(),
    attributes: step.attributes,
    statusCode: step.statusCode,
    statusMessage: step.statusMessage,
    events: step.events.map(storedEventToApi),
  }
}
