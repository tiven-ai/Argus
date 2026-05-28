import type { Step } from '@argus/shared-types'

export function RawTab({ step }: { step: Step }) {
  return (
    <pre className="text-xs bg-neutral-50 border p-3 rounded overflow-auto">
      {JSON.stringify(step, null, 2)}
    </pre>
  )
}
