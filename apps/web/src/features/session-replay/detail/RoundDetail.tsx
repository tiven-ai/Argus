import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Round } from '../types/round'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { RoundHeader } from './RoundHeader'
import { ContextSection } from './sections/ContextSection'
import { TriggerSection } from './sections/TriggerSection'
import { LlmResponseSection } from './sections/LlmResponseSection'
import { ExecutionSection } from './sections/ExecutionSection'
import { RawSection } from './sections/RawSection'

interface Props {
  round: Round
  index: number
  total: number
}

function SectionHeading({ title }: { title: string }) {
  return <h4 className="u-h-md text-text-1 mb-2">{title}</h4>
}

export function RoundDetail({ round, index, total }: Props) {
  const { t } = useTranslation()
  const [tab, setTab] = useState('request')

  return (
    <div className="h-full overflow-auto p-4 space-y-4">
      <RoundHeader round={round} index={index} total={total} />

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList>
          <TabsTrigger value="request">{t('round.tabs.request')}</TabsTrigger>
          <TabsTrigger value="execution">{t('round.tabs.execution')}</TabsTrigger>
          <TabsTrigger value="result">{t('round.tabs.result')}</TabsTrigger>
          <TabsTrigger value="raw">{t('round.tabs.raw')}</TabsTrigger>
        </TabsList>

        <TabsContent value="request" className="space-y-5">
          <section>
            <SectionHeading title={t('round.sections.trigger')} />
            <TriggerSection round={round} />
          </section>
          <section>
            <SectionHeading title={t('round.sections.context')} />
            <ContextSection round={round} />
          </section>
        </TabsContent>

        <TabsContent value="execution">
          <ExecutionSection round={round} />
        </TabsContent>

        <TabsContent value="result">
          <LlmResponseSection round={round} />
        </TabsContent>

        <TabsContent value="raw">
          <RawSection round={round} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
