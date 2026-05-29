import { User, Wrench } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Round } from '../../types/round'
import { findEvent } from '../../lib/step-helpers'

interface Props {
  round: Round
}

export function TriggerSection({ round }: Props) {
  const { t } = useTranslation()
  const trigger = round.trigger
  if (!trigger) {
    return <p className="u-body text-text-3">{t('round.trigger.initial')}</p>
  }

  if (trigger.kind === 'user_message') {
    const text = String(findEvent(trigger, 'argus.input')?.attributes.text ?? '(no text)')
    return (
      <div className="flex gap-3 items-start">
        <div className="w-7 h-7 rounded-md border border-hairline bg-page flex items-center justify-center shrink-0">
          <User className="h-4 w-4 text-brand" strokeWidth={1.75} />
        </div>
        <div className="rounded bg-tint-brand px-3 py-2 max-w-prose whitespace-pre-wrap u-body text-text-1">
          {text}
        </div>
      </div>
    )
  }

  if (trigger.kind === 'tool_call') {
    const toolName = trigger.componentName ?? trigger.name
    const output = findEvent(trigger, 'argus.output')?.attributes ?? {}
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 u-body text-text-2">
          <Wrench className="h-4 w-4 text-text-3" strokeWidth={1.75} />
          <span>
            {t('round.trigger.toolResultPrefix')}
            <span className="font-mono text-text-1">{toolName}</span>
          </span>
        </div>
        <pre className="u-caption bg-tint-success p-3 rounded overflow-auto text-text-1">
          {JSON.stringify(output, null, 2)}
        </pre>
      </div>
    )
  }

  return (
    <pre className="u-caption bg-tile border border-hairline p-3 rounded overflow-auto text-text-2">
      {JSON.stringify(trigger, null, 2)}
    </pre>
  )
}
