import type { Step } from '@argus/shared-types'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { findRenderer } from '../renderers/registry'
import { EventsTab } from './EventsTab'
import { RawTab } from './RawTab'
import { StepMetaHeader } from './StepMetaHeader'

export type TabKey = 'input' | 'output' | 'events' | 'raw'

interface Props {
  step: Step
  activeTab: TabKey
  onTabChange: (tab: TabKey) => void
}

export function StepDetail({ step, activeTab, onTabChange }: Props) {
  const renderer = findRenderer(step)

  return (
    <div className="h-full flex flex-col p-4 gap-4 overflow-hidden">
      <StepMetaHeader step={step} />
      <Tabs
        value={activeTab}
        onValueChange={(v) => onTabChange(v as TabKey)}
        className="flex-1 flex flex-col overflow-hidden"
      >
        <TabsList className="self-start">
          <TabsTrigger value="input">Input</TabsTrigger>
          <TabsTrigger value="output">Output</TabsTrigger>
          <TabsTrigger value="events">Events ({step.events.length})</TabsTrigger>
          <TabsTrigger value="raw">Raw</TabsTrigger>
        </TabsList>
        <TabsContent value="input" className="flex-1 overflow-auto mt-3">
          {renderer.renderInput ? (
            renderer.renderInput(step)
          ) : (
            <p className="text-neutral-500 text-sm">(no input renderer)</p>
          )}
        </TabsContent>
        <TabsContent value="output" className="flex-1 overflow-auto mt-3">
          {renderer.renderOutput ? (
            renderer.renderOutput(step)
          ) : (
            <p className="text-neutral-500 text-sm">(no output renderer)</p>
          )}
        </TabsContent>
        <TabsContent value="events" className="flex-1 overflow-auto mt-3">
          <EventsTab step={step} />
        </TabsContent>
        <TabsContent value="raw" className="flex-1 overflow-auto mt-3">
          <RawTab step={step} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
