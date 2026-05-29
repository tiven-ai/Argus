import { Wrench } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Round } from '../../types/round'
import { findEvent } from '../../lib/step-helpers'

interface Props {
  round: Round
}

export function ToolExecutionsSection({ round }: Props) {
  const { t } = useTranslation()
  if (round.toolExecutions.length === 0) {
    return <p className="u-body text-text-3">{t('round.toolExecution.empty')}</p>
  }
  return (
    <ul className="space-y-4">
      {round.toolExecutions.map((tool) => {
        const input = findEvent(tool, 'argus.input')?.attributes ?? {}
        const output = findEvent(tool, 'argus.output')?.attributes
        const toolName = tool.componentName ?? tool.name
        return (
          <li key={tool.id} className="border border-hairline rounded p-2 space-y-2">
            <div className="flex items-center gap-2 u-body">
              <Wrench className="h-4 w-4 text-text-3" strokeWidth={1.75} />
              <span className="font-mono text-text-1">{toolName}</span>
            </div>
            <div>
              <p className="u-caption text-text-3 mb-1">{t('round.toolExecution.input')}</p>
              <pre className="u-caption bg-tile border border-hairline p-2 rounded overflow-auto text-text-2">
                {JSON.stringify(input, null, 2)}
              </pre>
            </div>
            <div>
              <p className="u-caption text-text-3 mb-1">{t('round.toolExecution.output')}</p>
              {output ? (
                <pre className="u-caption bg-tint-success p-2 rounded overflow-auto text-text-1">
                  {JSON.stringify(output, null, 2)}
                </pre>
              ) : (
                <p className="u-caption text-text-4">{t('round.toolExecution.noOutput')}</p>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
