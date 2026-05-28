import { ArrowLeft } from 'lucide-react'
import { Link } from '@tanstack/react-router'
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
  return (
    <span
      title={active ? 'Streaming live' : 'Not connected'}
      className="inline-flex items-center gap-1 text-xs"
    >
      <span
        className={
          active
            ? 'inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse'
            : 'inline-block h-2 w-2 rounded-full bg-neutral-300'
        }
      />
      <span className={active ? 'text-emerald-700' : 'text-neutral-400'}>
        {active ? 'LIVE' : 'offline'}
      </span>
    </span>
  )
}

export function SessionTopbar({ session, steps, connected }: Props) {
  const duration = sessionDurationMs(steps)
  const status = sessionStatus(steps)
  const tokens = sessionTokens(steps)
  return (
    <div className="border-b px-6 py-3 flex items-center gap-4">
      <Link
        to="/sessions"
        className="text-neutral-500 hover:text-neutral-900"
        aria-label="Back to sessions"
      >
        <ArrowLeft className="h-4 w-4" />
      </Link>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-base font-semibold truncate">
            {session.projectName} / {session.serviceName}
          </h2>
          <Badge variant={statusVariant(status)}>{status}</Badge>
          <LiveDot active={connected} />
        </div>
        <p className="text-xs font-mono text-neutral-400 truncate">{session.traceId}</p>
      </div>
      <div className="text-xs text-neutral-500 flex items-center gap-3 shrink-0 tabular-nums">
        <span>{formatDuration(duration)}</span>
        {(tokens.input > 0 || tokens.output > 0) && (
          <span>
            tokens {tokens.input}/{tokens.output}
          </span>
        )}
        <span>{steps.length} steps</span>
      </div>
    </div>
  )
}
