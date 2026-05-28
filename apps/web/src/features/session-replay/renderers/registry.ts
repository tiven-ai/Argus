import type { Step } from '@argus/shared-types'
import type { StepRenderer } from './types'
import { GenericJsonRenderer } from './generic-json'

/**
 * Registered renderers, ordered by registration but resolved by priority.
 * Specialized renderers append themselves here in tasks M2-4..M2-7.
 */
export const renderers: StepRenderer[] = [GenericJsonRenderer]

export function registerRenderer(r: StepRenderer): void {
  renderers.push(r)
}

export function findRenderer(step: Step): StepRenderer {
  let best: StepRenderer = GenericJsonRenderer
  let bestPriority = best.match(step)
  for (const r of renderers) {
    const p = r.match(step)
    if (p > bestPriority) {
      best = r
      bestPriority = p
    }
  }
  return best
}
