import { Wrench } from 'lucide-react'
import type { StepRenderer } from './types'
import { findEvent } from '../lib/step-helpers'

export const ToolCallRenderer: StepRenderer = {
  id: 'tool-call',
  match: (step) => (step.kind === 'tool_call' ? 10 : 0),
  renderInput: (step) => {
    const input = findEvent(step, 'argus.input')
    const toolName = step.componentName ?? step.name
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm">
          <Wrench className="h-4 w-4 text-neutral-500" />
          <span className="font-mono">{toolName}</span>
        </div>
        <pre className="text-xs bg-neutral-50 border p-3 rounded overflow-auto">
          {JSON.stringify(input?.attributes ?? {}, null, 2)}
        </pre>
      </div>
    )
  },
  renderOutput: (step) => {
    const output = findEvent(step, 'argus.output')
    if (!output) return <p className="text-neutral-500 text-sm">(no output)</p>
    return (
      <pre className="text-xs bg-green-50 border border-green-100 p-3 rounded overflow-auto">
        {JSON.stringify(output.attributes, null, 2)}
      </pre>
    )
  },
}
