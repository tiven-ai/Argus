import type { ReactNode } from 'react'
import type { Step } from '@argus/shared-types'

export interface StepRenderer {
  /** Unique identifier for the renderer (used by tests; not user-visible). */
  id: string
  /** Higher number wins. Return 0 to opt out. */
  match: (step: Step) => number
  /** Content for the Input tab. */
  renderInput?: (step: Step) => ReactNode
  /** Content for the Output tab. */
  renderOutput?: (step: Step) => ReactNode
}
