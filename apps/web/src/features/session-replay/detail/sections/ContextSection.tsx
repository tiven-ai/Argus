import type { Round } from '../../types/round'
import { findEvent } from '../../lib/step-helpers'

interface Props {
  round: Round
}

function MessageRow({
  role,
  content,
  toolCalls,
}: {
  role: string
  content?: string
  toolCalls?: unknown[]
}) {
  return (
    <li className="border rounded p-2 text-sm">
      <p className="text-xs text-neutral-500 mb-1 uppercase tracking-wide">{role}</p>
      {content && content.length > 0 && (
        <pre className="whitespace-pre-wrap text-sm">{content}</pre>
      )}
      {toolCalls && toolCalls.length > 0 && (
        <pre className="text-xs bg-neutral-50 border mt-1 p-2 rounded overflow-auto">
          {JSON.stringify(toolCalls, null, 2)}
        </pre>
      )}
    </li>
  )
}

export function ContextSection({ round }: Props) {
  const input = findEvent(round.llmCall, 'argus.input')?.attributes ?? {}
  const messages = Array.isArray(input.messages) ? input.messages : []
  const tools = Array.isArray(input.tools) ? input.tools : []

  // System prompt: prefer explicit `system_prompt` on input, fall back to first
  // message with role=system.
  const explicit = typeof input.system_prompt === 'string' ? input.system_prompt : null
  const systemFromMessages =
    messages.find((m) => (m as { role?: unknown }).role === 'system') ?? null
  const systemPrompt =
    explicit ??
    (typeof (systemFromMessages as { content?: unknown })?.content === 'string'
      ? (systemFromMessages as { content: string }).content
      : null)

  const nonSystemMessages = messages.filter((m) => (m as { role?: unknown }).role !== 'system')

  return (
    <div className="space-y-4">
      {systemPrompt && (
        <div>
          <h4 className="text-xs font-semibold text-neutral-500 uppercase mb-1">System prompt</h4>
          <pre className="text-sm bg-neutral-50 border p-3 rounded whitespace-pre-wrap">
            {systemPrompt}
          </pre>
        </div>
      )}
      {tools.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-neutral-500 uppercase mb-1">Tools available</h4>
          <pre className="text-xs bg-neutral-50 border p-2 rounded overflow-auto">
            {JSON.stringify(tools, null, 2)}
          </pre>
        </div>
      )}
      {nonSystemMessages.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-neutral-500 uppercase mb-1">Message history</h4>
          <ul className="space-y-2">
            {nonSystemMessages.map((m, i) => {
              const obj = m as {
                role?: unknown
                content?: unknown
                tool_calls?: unknown[]
              }
              return (
                <MessageRow
                  key={i}
                  role={String(obj.role ?? 'unknown')}
                  content={typeof obj.content === 'string' ? obj.content : undefined}
                  toolCalls={Array.isArray(obj.tool_calls) ? obj.tool_calls : undefined}
                />
              )
            })}
          </ul>
        </div>
      )}
      {!systemPrompt && tools.length === 0 && nonSystemMessages.length === 0 && (
        <p className="text-neutral-500 text-sm">(no context captured for this round)</p>
      )}
    </div>
  )
}
