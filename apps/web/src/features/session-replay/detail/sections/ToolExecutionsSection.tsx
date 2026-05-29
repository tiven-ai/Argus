import { Wrench } from 'lucide-react'
import type { Round } from '../../types/round'
import { findEvent } from '../../lib/step-helpers'

interface Props {
  round: Round
}

export function ToolExecutionsSection({ round }: Props) {
  if (round.toolExecutions.length === 0) {
    return <p className="u-body text-text-3">(no tool executions)</p>
  }
  return (
    <ul className="space-y-4">
      {round.toolExecutions.map((t) => {
        const input = findEvent(t, 'argus.input')?.attributes ?? {}
        const output = findEvent(t, 'argus.output')?.attributes
        const toolName = t.componentName ?? t.name
        return (
          <li key={t.id} className="border border-hairline rounded p-2 space-y-2">
            <div className="flex items-center gap-2 u-body">
              <Wrench className="h-4 w-4 text-text-3" strokeWidth={1.75} />
              <span className="font-mono text-text-1">{toolName}</span>
            </div>
            <div>
              <p className="u-caption text-text-3 mb-1">Input</p>
              <pre className="u-caption bg-tile border border-hairline p-2 rounded overflow-auto text-text-2">
                {JSON.stringify(input, null, 2)}
              </pre>
            </div>
            <div>
              <p className="u-caption text-text-3 mb-1">Output</p>
              {output ? (
                <pre className="u-caption bg-tint-success p-2 rounded overflow-auto text-text-1">
                  {JSON.stringify(output, null, 2)}
                </pre>
              ) : (
                <p className="u-caption text-text-4">(no output)</p>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
