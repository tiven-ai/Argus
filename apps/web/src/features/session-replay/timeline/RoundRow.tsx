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
        active ? 'bg-blue-50 border-l-blue-500' : 'border-l-transparent hover:bg-neutral-50',
      )}
    >
      <span className="text-xs text-neutral-400 w-6 shrink-0 mt-0.5 tabular-nums">{index + 1}</span>
      <Icon className="h-4 w-4 mt-0.5 text-neutral-600 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{label}</p>
        {snippet && <p className="text-xs text-neutral-500 truncate">{snippet}</p>}
      </div>
      <div className="text-xs text-neutral-400 shrink-0 tabular-nums">
        {formatDuration(durationMs(round.llmCall))}
      </div>
    </button>
  )
}
