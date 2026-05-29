import { useTranslation } from 'react-i18next'
import type { Round } from '../../types/round'
import { findEvent } from '../../lib/step-helpers'
import { ToolCallList, ToolDefinitionsList } from './tool-displays'

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
  let displayContent = content
  if (role === 'tool' && typeof content === 'string') {
    try {
      displayContent = JSON.stringify(JSON.parse(content), null, 2)
    } catch {
      // leave as raw
    }
  }
  return (
    <li className="border border-hairline rounded p-2">
      <p className="u-caption text-text-3 mb-1">{role}</p>
      {displayContent && displayContent.length > 0 && (
        <pre className="whitespace-pre-wrap u-body text-text-2">{displayContent}</pre>
      )}
      {toolCalls && toolCalls.length > 0 && (
        <div className="mt-2">
          <ToolCallList toolCalls={toolCalls} />
        </div>
      )}
    </li>
  )
}

export function ContextSection({ round }: Props) {
  const { t } = useTranslation()
  const input = findEvent(round.llmCall, 'argus.input')?.attributes ?? {}
  const messages = Array.isArray(input.messages) ? input.messages : []
  const tools = Array.isArray(input.tools) ? input.tools : []

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
          <h4 className="u-caption text-text-3 mb-1">{t('round.context.systemPrompt')}</h4>
          <pre className="u-body bg-tile border border-hairline p-3 rounded whitespace-pre-wrap text-text-2">
            {systemPrompt}
          </pre>
        </div>
      )}
      {tools.length > 0 && (
        <div>
          <h4 className="u-caption text-text-3 mb-1">{t('round.context.toolsAvailable')}</h4>
          <ToolDefinitionsList tools={tools} />
        </div>
      )}
      {nonSystemMessages.length > 0 && (
        <div>
          <h4 className="u-caption text-text-3 mb-1">{t('round.context.messageHistory')}</h4>
          <ul className="space-y-2">
            {nonSystemMessages.map((m, i) => {
              const obj = m as { role?: unknown; content?: unknown; tool_calls?: unknown[] }
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
        <p className="u-body text-text-3">{t('round.context.empty')}</p>
      )}
    </div>
  )
}
