import type { Step } from '@argus/shared-types'
import { cn } from '@/lib/utils'
import { durationMs, formatDuration } from '../lib/step-helpers'
import { iconForStep } from './step-icons'

interface Props {
  step: Step
  index: number
  active: boolean
  onClick: () => void
}

export function StepRow({ step, index, active, onClick }: Props) {
  const Icon = iconForStep(step)
  const label = step.kind ?? step.name
  const sub = step.componentName ?? step.name
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
        <p className="text-xs text-neutral-500 truncate">{sub}</p>
      </div>
      <div className="text-xs text-neutral-400 shrink-0 tabular-nums">
        {formatDuration(durationMs(step))}
      </div>
    </button>
  )
}
