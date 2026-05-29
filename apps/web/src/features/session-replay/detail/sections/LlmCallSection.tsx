import type { Round } from '../../types/round'
import { findEvent } from '../../lib/step-helpers'

interface Props {
  round: Round
}

export function LlmCallSection({ round }: Props) {
  const output = findEvent(round.llmCall, 'argus.output')?.attributes ?? {}
  const text = typeof output.text === 'string' ? output.text : undefined
  const toolCalls = Array.isArray(output.tool_calls) ? output.tool_calls : undefined
  const stopReason = typeof output.stop_reason === 'string' ? output.stop_reason : undefined

  return (
    <div className="space-y-4">
      {text && (
        <div>
          <h4 className="text-xs font-semibold text-neutral-500 uppercase mb-1">Text</h4>
          <pre className="text-sm bg-amber-50 border border-amber-100 p-3 rounded whitespace-pre-wrap">
            {text}
          </pre>
        </div>
      )}
      {toolCalls && (
        <div>
          <h4 className="text-xs font-semibold text-neutral-500 uppercase mb-1">Tool calls</h4>
          <pre className="text-xs bg-neutral-50 border p-2 rounded overflow-auto">
            {JSON.stringify(toolCalls, null, 2)}
          </pre>
        </div>
      )}
      {stopReason && <p className="text-xs text-neutral-500">stop: {stopReason}</p>}
      {!text && !toolCalls && (
        <pre className="text-xs bg-neutral-50 border p-3 rounded overflow-auto">
          {JSON.stringify(output, null, 2)}
        </pre>
      )}
    </div>
  )
}
