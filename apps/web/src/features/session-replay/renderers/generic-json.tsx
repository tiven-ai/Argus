import type { StepRenderer } from './types'
import { findEvent } from '../lib/step-helpers'

function JsonView({ data }: { data: unknown }) {
  return (
    <pre className="text-xs bg-neutral-50 border border-neutral-200 p-3 rounded overflow-auto">
      {JSON.stringify(data, null, 2)}
    </pre>
  )
}

export const GenericJsonRenderer: StepRenderer = {
  id: 'generic-json',
  match: () => 1,
  renderInput: (step) => {
    const input = findEvent(step, 'argus.input')
    return input ? (
      <JsonView data={input.attributes} />
    ) : (
      <p className="text-neutral-500 text-sm">(no input)</p>
    )
  },
  renderOutput: (step) => {
    const output = findEvent(step, 'argus.output')
    return output ? (
      <JsonView data={output.attributes} />
    ) : (
      <p className="text-neutral-500 text-sm">(no output)</p>
    )
  },
}
