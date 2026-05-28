import type { SessionSummary, Step } from '@argus/shared-types'
import { SessionTopbar } from './topbar/SessionTopbar'
import { StepDetail, type TabKey } from './detail/StepDetail'
import { StepTimeline } from './timeline/StepTimeline'

interface Props {
  session: SessionSummary
  steps: Step[]
  activeStepId: string | undefined
  activeTab: TabKey
  connected: boolean
  onSelectStep: (id: string) => void
  onSelectTab: (tab: TabKey) => void
}

export function SessionReplay({
  session,
  steps,
  activeStepId,
  activeTab,
  connected,
  onSelectStep,
  onSelectTab,
}: Props) {
  const activeStep = steps.find((s) => s.id === activeStepId) ?? steps[0]
  return (
    <div className="h-full flex flex-col">
      <SessionTopbar session={session} steps={steps} connected={connected} />
      <div className="flex-1 grid grid-cols-[380px_1fr] overflow-hidden">
        <aside className="border-r overflow-hidden">
          <StepTimeline steps={steps} activeStepId={activeStep?.id} onSelect={onSelectStep} />
        </aside>
        <main className="overflow-hidden">
          {activeStep ? (
            <StepDetail step={activeStep} activeTab={activeTab} onTabChange={onSelectTab} />
          ) : (
            <p className="p-6 text-neutral-500 text-sm">(empty session — no steps)</p>
          )}
        </main>
      </div>
    </div>
  )
}
