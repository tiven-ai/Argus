import { useEffect, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { Step } from '@argus/shared-types'
import { StepRow } from './StepRow'

interface Props {
  steps: Step[]
  activeStepId: string | undefined
  onSelect: (stepId: string) => void
}

export function StepTimeline({ steps, activeStepId, onSelect }: Props) {
  const parentRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: steps.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 56,
    overscan: 6,
  })

  useEffect(() => {
    if (!activeStepId) return
    const i = steps.findIndex((s) => s.id === activeStepId)
    if (i >= 0) virtualizer.scrollToIndex(i, { align: 'center' })
  }, [activeStepId, steps, virtualizer])

  return (
    <div ref={parentRef} className="h-full overflow-auto">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((vi) => {
          const step = steps[vi.index]
          if (!step) return null
          return (
            <div
              key={vi.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${vi.start}px)`,
              }}
            >
              <StepRow
                step={step}
                index={vi.index}
                active={step.id === activeStepId}
                onClick={() => onSelect(step.id)}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
