import { User, Wrench } from 'lucide-react'
import type { Round } from '../../types/round'
import { findEvent } from '../../lib/step-helpers'

interface Props {
  round: Round
}

export function TriggerSection({ round }: Props) {
  const t = round.trigger
  if (!t) {
    return (
      <p className="text-neutral-500 text-sm">
        (initial round — no preceding user message or tool result)
      </p>
    )
  }

  if (t.kind === 'user_message') {
    const text = String(findEvent(t, 'argus.input')?.attributes.text ?? '(no text)')
    return (
      <div className="flex gap-3 items-start">
        <div className="rounded-full bg-blue-100 p-2 shrink-0">
          <User className="h-4 w-4 text-blue-700" />
        </div>
        <div className="rounded-lg bg-blue-50 border border-blue-100 px-4 py-3 max-w-prose whitespace-pre-wrap text-sm">
          {text}
        </div>
      </div>
    )
  }

  if (t.kind === 'tool_call') {
    const toolName = t.componentName ?? t.name
    const output = findEvent(t, 'argus.output')?.attributes ?? {}
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-neutral-600">
          <Wrench className="h-4 w-4" />
          <span>
            Tool result · <span className="font-mono">{toolName}</span>
          </span>
        </div>
        <pre className="text-xs bg-green-50 border border-green-100 p-3 rounded overflow-auto">
          {JSON.stringify(output, null, 2)}
        </pre>
      </div>
    )
  }

  return (
    <pre className="text-xs bg-neutral-50 border p-3 rounded overflow-auto">
      {JSON.stringify(t, null, 2)}
    </pre>
  )
}
