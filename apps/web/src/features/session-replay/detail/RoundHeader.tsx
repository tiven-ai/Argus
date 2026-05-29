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
    <div className="space-y-2 pb-3 border-b border-hairline">
      <div className="flex items-baseline justify-between gap-3 min-w-0">
        <h3 className="u-h-lg text-text-1 truncate">
          Round {index + 1} / {total}
        </h3>
        <span className="u-caption font-mono text-text-4 shrink-0 tabular">
          {round.llmCall.spanId.slice(0, 12)}
        </span>
      </div>
      <div className="flex flex-wrap gap-2 items-center u-caption text-text-3">
        <Badge variant={statusVariant(round.llmCall.statusCode)}>{round.llmCall.statusCode}</Badge>
        <span className="tabular">{formatDuration(durationMs(round.llmCall))}</span>
        {model && <span>· {model}</span>}
        {tokens && (
          <span className="tabular">
            · tokens {tokens.input}/{tokens.output}
          </span>
        )}
        {round.toolExecutions.length > 0 && (
          <span className="tabular">· {round.toolExecutions.length} tool exec</span>
        )}
      </div>
    </div>
  )
}
