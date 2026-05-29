import type { Round } from '../types/round'
import { Badge } from '@/components/ui/badge'
import { durationMs, formatDuration, tokenUsage } from '../lib/step-helpers'

interface Props {
  round: Round
  index: number
  total: number
}

function statusVariant(code: string) {
  if (code === 'OK') return 'default' as const
  if (code === 'ERROR') return 'destructive' as const
  return 'secondary' as const
}

export function RoundHeader({ round, index, total }: Props) {
  const tokens = tokenUsage(round.llmCall)
  const model = String(
    round.llmCall.attributes['gen_ai.request.model'] ?? round.llmCall.componentName ?? '',
  )
  return (
    <div className="space-y-2 pb-3 border-b">
      <div className="flex items-baseline justify-between gap-3 min-w-0">
        <h3 className="text-base font-semibold truncate">
          Round {index + 1} / {total}
        </h3>
        <span className="text-xs font-mono text-neutral-400 shrink-0">
          {round.llmCall.spanId.slice(0, 12)}
        </span>
      </div>
      <div className="flex flex-wrap gap-2 items-center text-xs text-neutral-500">
        <Badge variant={statusVariant(round.llmCall.statusCode)}>{round.llmCall.statusCode}</Badge>
        <span>{formatDuration(durationMs(round.llmCall))}</span>
        {model && <span>· {model}</span>}
        {tokens && (
          <span>
            · tokens: {tokens.input}/{tokens.output}
          </span>
        )}
        {round.toolExecutions.length > 0 && <span>· {round.toolExecutions.length} tool exec</span>}
      </div>
    </div>
  )
}
