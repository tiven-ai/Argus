import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
  const rounds = useMemo(() => computeRounds(steps), [steps])
  const activeRound = rounds.find((r) => r.id === activeRoundId) ?? rounds[0]
  const activeIndex = activeRound ? rounds.indexOf(activeRound) : -1

  return (
    <div className="h-full flex flex-col">
      <SessionTopbar session={session} steps={steps} connected={connected} />
      <div className="flex-1 grid grid-cols-1 grid-rows-[1fr_1fr] sm:grid-rows-1 sm:grid-cols-[minmax(280px,360px)_1fr] overflow-hidden">
        <aside className="border-b sm:border-b-0 sm:border-r border-hairline overflow-hidden">
          <RoundTimeline rounds={rounds} activeRoundId={activeRound?.id} onSelect={onSelectRound} />
        </aside>
        <main className="overflow-hidden">
          {activeRound ? (
            <RoundDetail round={activeRound} index={activeIndex} total={rounds.length} />
          ) : (
            <p className="p-6 u-body text-text-3">{t('sessions.replay.noRounds')}</p>
          )}
        </main>
      </div>
    </div>
  )
}
