import { Wrench } from 'lucide-react'
import type { Round } from '../../types/round'
import { findEvent } from '../../lib/step-helpers'

interface Props {
  round: Round
}

export function ToolExecutionsSection({ round }: Props) {
  if (round.toolExecutions.length === 0) {
    return <p className="text-neutral-500 text-sm">(no tool executions)</p>
  }
  return (
    <ul className="space-y-4">
      {round.toolExecutions.map((t) => {
        const input = findEvent(t, 'argus.input')?.attributes ?? {}
        const output = findEvent(t, 'argus.output')?.attributes
        const toolName = t.componentName ?? t.name
        return (
          <li key={t.id} className="border rounded p-3 space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <Wrench className="h-4 w-4 text-neutral-500" />
              <span className="font-mono">{toolName}</span>
            </div>
            <div>
              <p className="text-xs text-neutral-500 mb-1 uppercase">Input</p>
              <pre className="text-xs bg-neutral-50 border p-2 rounded overflow-auto">
                {JSON.stringify(input, null, 2)}
              </pre>
            </div>
            <div>
              <p className="text-xs text-neutral-500 mb-1 uppercase">Output</p>
              {output ? (
                <pre className="text-xs bg-green-50 border border-green-100 p-2 rounded overflow-auto">
                  {JSON.stringify(output, null, 2)}
                </pre>
              ) : (
                <p className="text-xs text-neutral-500">(no output)</p>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
