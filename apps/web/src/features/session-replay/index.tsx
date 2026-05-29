import { useMemo } from 'react'
import type { SessionSummary, Step } from '@argus/shared-types'
import { SessionTopbar } from './topbar/SessionTopbar'
import { RoundDetail } from './detail/RoundDetail'
import { RoundTimeline } from './timeline/RoundTimeline'
import { computeRounds } from './lib/compute-rounds'

interface Props {
  session: SessionSummary
  steps: Step[]
  activeRoundId: string | undefined
  connected: boolean
  onSelectRound: (id: string) => void
}

export function SessionReplay({ session, steps, activeRoundId, connected, onSelectRound }: Props) {
  const rounds = useMemo(() => computeRounds(steps), [steps])
  const activeRound = rounds.find((r) => r.id === activeRoundId) ?? rounds[0]
  const activeIndex = activeRound ? rounds.indexOf(activeRound) : -1

  return (
    <div className="h-full flex flex-col">
      <SessionTopbar session={session} steps={steps} connected={connected} />
      <div className="flex-1 grid grid-cols-[380px_1fr] overflow-hidden">
        <aside className="border-r overflow-hidden">
          <RoundTimeline rounds={rounds} activeRoundId={activeRound?.id} onSelect={onSelectRound} />
        </aside>
        <main className="overflow-hidden">
          {activeRound ? (
            <RoundDetail round={activeRound} index={activeIndex} total={rounds.length} />
          ) : (
            <p className="p-6 text-neutral-500 text-sm">
              (no rounds in this session — needs at least one LLM call)
            </p>
          )}
        </main>
      </div>
    </div>
  )
}
