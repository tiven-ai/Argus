import { ChevronDown, ChevronRight } from 'lucide-react'
import type { Round } from '../types/round'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { RoundHeader } from './RoundHeader'
import { ContextSection } from './sections/ContextSection'
import { TriggerSection } from './sections/TriggerSection'
import { LlmResponseSection } from './sections/LlmResponseSection'
import { ToolExecutionsSection } from './sections/ToolExecutionsSection'
import { RawSection } from './sections/RawSection'

interface Props {
  round: Round
  index: number
  total: number
}

function SectionHeader({ icon, title }: { icon: string; title: string }) {
  return (
    <h4 className="text-sm font-semibold flex items-center gap-2 mb-2">
      <span aria-hidden="true">{icon}</span>
      <span>{title}</span>
    </h4>
  )
}

function CollapsibleSectionHeader({
  icon,
  title,
  open,
}: {
  icon: string
  title: string
  open: boolean
}) {
  return (
    <h4 className="text-sm font-semibold flex items-center gap-2 cursor-pointer select-none hover:text-neutral-900 text-neutral-600">
      {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      <span aria-hidden="true">{icon}</span>
      <span>{title}</span>
    </h4>
  )
}

export function RoundDetail({ round, index, total }: Props) {
  return (
    <div className="h-full overflow-auto p-4 space-y-5">
      <RoundHeader round={round} index={index} total={total} />

      <Collapsible defaultOpen={false}>
        <CollapsibleTrigger asChild>
          <button type="button" className="w-full text-left">
            <CollapsibleSectionHeader icon="📋" title="Context" open={false} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2">
          <ContextSection round={round} />
        </CollapsibleContent>
      </Collapsible>

      <section>
        <SectionHeader icon="⚡" title="Trigger" />
        <TriggerSection round={round} />
      </section>

      <section>
        <SectionHeader icon="🧠" title="LLM Response" />
        <LlmResponseSection round={round} />
      </section>

      {round.toolExecutions.length > 0 && (
        <section>
          <SectionHeader icon="🔧" title="Tool execution" />
          <ToolExecutionsSection round={round} />
        </section>
      )}

      <Collapsible defaultOpen={false}>
        <CollapsibleTrigger asChild>
          <button type="button" className="w-full text-left">
            <CollapsibleSectionHeader icon="🗂️" title="Raw" open={false} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2">
          <RawSection round={round} />
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
