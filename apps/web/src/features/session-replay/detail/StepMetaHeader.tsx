import type { Step } from '@argus/shared-types'
import { Badge } from '@/components/ui/badge'
import { durationMs, formatDuration, tokenUsage } from '../lib/step-helpers'

interface Props {
  step: Step
}

function statusVariant(code: string) {
  if (code === 'OK') return 'default' as const
  if (code === 'ERROR') return 'destructive' as const
  return 'secondary' as const
}

export function StepMetaHeader({ step }: Props) {
  const tokens = tokenUsage(step)
  return (
    <div className="space-y-2 pb-3 border-b">
      <div className="flex items-baseline justify-between gap-3 min-w-0">
        <h3 className="text-base font-semibold truncate">{step.kind ?? step.name}</h3>
        <span className="text-xs font-mono text-neutral-400 shrink-0">
          {step.spanId.slice(0, 12)}
        </span>
      </div>
      <div className="flex flex-wrap gap-2 items-center text-xs text-neutral-500">
        <Badge variant={statusVariant(step.statusCode)}>{step.statusCode}</Badge>
        <span>{formatDuration(durationMs(step))}</span>
        {step.componentName && <span>· {step.componentName}</span>}
        {tokens && (
          <span>
            · tokens: {tokens.input}/{tokens.output}
          </span>
        )}
      </div>
    </div>
  )
}
