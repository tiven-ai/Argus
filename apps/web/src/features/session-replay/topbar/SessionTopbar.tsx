import { ArrowLeft } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import type { SessionSummary, Step } from '@argus/shared-types'
import { Badge } from '@/components/ui/badge'
import {
  formatDuration,
  sessionDurationMs,
  sessionStatus,
  sessionTokens,
} from '../lib/step-helpers'

interface Props {
  session: SessionSummary
  steps: Step[]
  connected: boolean
}

function statusVariant(s: 'OK' | 'ERROR' | 'UNSET') {
  if (s === 'OK') return 'default' as const
  if (s === 'ERROR') return 'destructive' as const
  return 'secondary' as const
}

function LiveDot({ active }: { active: boolean }) {
  const { t } = useTranslation()
  return (
    <span
      title={active ? t('topbar.streamingLive') : t('topbar.notConnected')}
      className="inline-flex items-center gap-1 u-caption"
    >
      <span
        className={
          active
            ? 'inline-block h-1.5 w-1.5 rounded-pill bg-success animate-pulse'
            : 'inline-block h-1.5 w-1.5 rounded-pill bg-text-4'
        }
      />
      <span className={active ? 'text-success' : 'text-text-4'}>
        {active ? t('topbar.live') : t('topbar.offline')}
      </span>
    </span>
  )
}

export function SessionTopbar({ session, steps, connected }: Props) {
  const { t } = useTranslation()
  const duration = sessionDurationMs(steps)
  const status = sessionStatus(steps)
  const tokens = sessionTokens(steps)
  return (
    <div className="border-b border-hairline px-6 py-2.5 flex items-center gap-4">
      <Link
        to="/sessions"
        className="text-text-3 hover:text-text-1 transition-colors"
        aria-label={t('topbar.back')}
      >
        <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
      </Link>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="u-h-lg text-text-1 truncate">
            {session.projectName} / {session.serviceName}
          </h2>
          <Badge variant={statusVariant(status)}>{status}</Badge>
          <LiveDot active={connected} />
        </div>
        <p className="u-caption font-mono text-text-4 truncate tabular">{session.traceId}</p>
      </div>
      <div className="u-caption text-text-3 flex items-center gap-3 shrink-0 tabular">
        <span>{formatDuration(duration)}</span>
        {(tokens.input > 0 || tokens.output > 0) && (
          <span>{t('topbar.tokens', { input: tokens.input, output: tokens.output })}</span>
        )}
        <span>{t('topbar.stepCount', { count: steps.length })}</span>
      </div>
    </div>
  )
}
