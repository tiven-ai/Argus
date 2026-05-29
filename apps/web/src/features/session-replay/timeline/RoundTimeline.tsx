import { useEffect, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { Round } from '../types/round'
import { RoundRow } from './RoundRow'

interface Props {
  rounds: Round[]
  activeRoundId: string | undefined
  onSelect: (roundId: string) => void
}

export function RoundTimeline({ rounds, activeRoundId, onSelect }: Props) {
  const parentRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: rounds.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 64,
    overscan: 6,
  })

  const lastScrolledRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!activeRoundId || activeRoundId === lastScrolledRef.current) return
    const i = rounds.findIndex((r) => r.id === activeRoundId)
    if (i >= 0) {
      virtualizer.scrollToIndex(i, { align: 'center' })
      lastScrolledRef.current = activeRoundId
    }
    // virtualizer intentionally omitted from deps to avoid scroll-storm under streaming
  }, [activeRoundId, rounds])

  if (rounds.length === 0) {
    return (
      <div className="p-3 u-body text-text-3">
        <p>No rounds yet.</p>
        <p className="mt-2">
          Rounds appear when a session contains at least one LLM call. Try{' '}
          <code className="bg-tile px-1 rounded text-text-2">pnpm db:seed</code>.
        </p>
      </div>
    )
  }

  return (
    <div ref={parentRef} className="h-full overflow-auto">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((vi) => {
          const round = rounds[vi.index]
          if (!round) return null
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
              <RoundRow
                round={round}
                index={vi.index}
                active={round.id === activeRoundId}
                onClick={() => onSelect(round.id)}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
