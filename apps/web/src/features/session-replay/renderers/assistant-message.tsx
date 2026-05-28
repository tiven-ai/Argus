import { Sparkles } from 'lucide-react'
import type { StepRenderer } from './types'
import { findEvent } from '../lib/step-helpers'

function AssistantBubble({ text, toolCalls }: { text?: string; toolCalls?: unknown[] }) {
  return (
    <div className="flex gap-3 items-start">
      <div className="rounded-full bg-amber-100 p-2 shrink-0">
        <Sparkles className="h-4 w-4 text-amber-700" />
      </div>
      <div className="space-y-2 flex-1 min-w-0">
        {text && (
          <div className="rounded-lg bg-amber-50 border border-amber-100 px-4 py-3 max-w-prose whitespace-pre-wrap text-sm">
            {text}
          </div>
        )}
        {toolCalls && toolCalls.length > 0 && (
          <div className="text-xs text-neutral-600">
            <p className="font-semibold mb-1 text-neutral-500 uppercase">Tool calls</p>
            <pre className="bg-neutral-50 border border-neutral-200 p-2 rounded overflow-auto">
              {JSON.stringify(toolCalls, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}

export const AssistantMessageRenderer: StepRenderer = {
  id: 'assistant-message',
  match: (step) => (step.kind === 'assistant_message' ? 10 : 0),
  renderInput: () => (
    <p className="text-neutral-500 text-sm">(input was the previous user message)</p>
  ),
  renderOutput: (step) => {
    const output = findEvent(step, 'argus.output')
    if (!output) return <p className="text-neutral-500 text-sm">(no output)</p>
    const attrs = output.attributes
    const text = typeof attrs.text === 'string' ? attrs.text : undefined
    const toolCalls = Array.isArray(attrs.tool_calls) ? attrs.tool_calls : undefined
    if (!text && !toolCalls) {
      return (
        <pre className="text-xs bg-neutral-50 border p-3 rounded overflow-auto">
          {JSON.stringify(attrs, null, 2)}
        </pre>
      )
    }
    return <AssistantBubble text={text} toolCalls={toolCalls} />
  },
}
