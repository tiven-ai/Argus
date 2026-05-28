import type { Step } from '@argus/shared-types'

interface Props {
  step: Step
}

export function EventsTab({ step }: Props) {
  if (step.events.length === 0) {
    return <p className="text-neutral-500 text-sm">(no events)</p>
  }
  return (
    <ul className="space-y-3">
      {step.events.map((e) => (
        <li key={e.id} className="border rounded p-3">
          <div className="flex items-baseline justify-between text-xs text-neutral-500 mb-2">
            <span className="font-mono">{e.name}</span>
            <span>{new Date(e.ts).toLocaleTimeString()}</span>
          </div>
          <pre className="text-xs bg-neutral-50 border p-2 rounded overflow-auto">
            {JSON.stringify(e.attributes, null, 2)}
          </pre>
        </li>
      ))}
    </ul>
  )
}
