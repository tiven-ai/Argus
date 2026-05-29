import { useTranslation } from 'react-i18next'
import type { Round } from '../../types/round'
import { findEvent } from '../../lib/step-helpers'
import { ToolCallList } from './tool-displays'

interface Props {
  round: Round
}

export function LlmResponseSection({ round }: Props) {
  const { t } = useTranslation()
  const output = findEvent(round.llmCall, 'argus.output')?.attributes ?? {}
  const text = typeof output.text === 'string' ? output.text : undefined
  const toolCalls = Array.isArray(output.tool_calls) ? output.tool_calls : undefined
  const stopReason = typeof output.stop_reason === 'string' ? output.stop_reason : undefined

  return (
    <div className="space-y-4">
      {text && (
        <div>
          <h4 className="u-caption text-text-3 mb-1">{t('round.llmResponse.text')}</h4>
          <pre className="u-body bg-tile border border-hairline p-3 rounded whitespace-pre-wrap text-text-1">
            {text}
          </pre>
        </div>
      )}
      {toolCalls && (
        <div>
          <h4 className="u-caption text-text-3 mb-1">{t('round.llmResponse.toolCalls')}</h4>
          <ToolCallList toolCalls={toolCalls} />
        </div>
      )}
      {stopReason && (
        <p className="u-caption text-text-3">
          {t('round.llmResponse.stop', { reason: stopReason })}
        </p>
      )}
      {!text && !toolCalls && (
        <pre className="u-caption bg-tile border border-hairline p-3 rounded overflow-auto text-text-2">
          {JSON.stringify(output, null, 2)}
        </pre>
      )}
    </div>
  )
}
