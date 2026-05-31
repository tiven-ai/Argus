import { Wrench } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Step } from '@argus/shared-types'
import type { Round } from '../../types/round'
import { findEvent } from '../../lib/step-helpers'
import { classifyExecutions } from '../../lib/classify-execution'

interface Props {
  round: Round
}

function ExecutionCard({ step }: { step: Step }) {
  const { t } = useTranslation()
  const input = findEvent(step, 'argus.input')?.attributes ?? {}
  const output = findEvent(step, 'argus.output')?.attributes
  const name = step.componentName ?? step.name
  return (
    <li className="border border-hairline rounded p-2 space-y-2">
      <div className="flex items-center gap-2 u-body">
        <Wrench className="h-4 w-4 text-text-3" strokeWidth={1.75} />
        <span className="font-mono text-text-1">{name}</span>
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
}

export function ExecutionSection({ round }: Props) {
  const { t } = useTranslation()
  const groups = classifyExecutions(round.toolExecutions)

  if (groups.length === 0) {
    return <p className="u-body text-text-3">{t('round.toolExecution.empty')}</p>
  }

  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <div key={group.category}>
          <h4 className="u-caption text-text-3 mb-2">{t(`round.execution.${group.category}`)}</h4>
          <ul className="space-y-4">
            {group.steps.map((step) => (
              <ExecutionCard key={step.id} step={step} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
