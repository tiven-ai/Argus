import type { Round } from '../types/round'
import { cn } from '@/lib/utils'
import { durationMs, findEvent, formatDuration } from '../lib/step-helpers'
import { iconForRoundTrigger, labelForRoundTrigger } from './round-icons'

interface Props {
  round: Round
  index: number
  active: boolean
  onClick: () => void
}

function snippetForTrigger(round: Round): string | null {
  if (!round.trigger) return null
  if (round.trigger.kind === 'user_message') {
    const text = findEvent(round.trigger, 'argus.input')?.attributes.text
    return typeof text === 'string' ? text : null
  }
  if (round.trigger.kind === 'tool_call') {
    const output = findEvent(round.trigger, 'argus.output')?.attributes
    if (output && typeof output === 'object') {
      const summary = JSON.stringify(output)
      return summary.length > 80 ? summary.slice(0, 80) + '…' : summary
    }
  }
  return null
}

export function RoundRow({ round, index, active, onClick }: Props) {
  const Icon = iconForRoundTrigger(round)
  const label = labelForRoundTrigger(round)
  const snippet = snippetForTrigger(round)
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full flex items-start gap-2 px-3 py-2 text-left border-l-2 transition-colors',
        active ? 'bg-tint-brand border-l-brand' : 'border-l-transparent hover:bg-tile',
      )}
    >
      <span className="u-caption text-text-4 w-5 shrink-0 mt-0.5 tabular">{index + 1}</span>
      <Icon className="h-4 w-4 mt-0.5 text-text-3 shrink-0" strokeWidth={1.75} />
      <div className="flex-1 min-w-0">
        <p className="u-h-md text-text-1 truncate">{label}</p>
        {snippet && <p className="u-caption text-text-3 truncate">{snippet}</p>}
      </div>
      <div className="u-caption text-text-4 shrink-0 mt-0.5 tabular">
        {formatDuration(durationMs(round.llmCall))}
      </div>
    </button>
  )
}
