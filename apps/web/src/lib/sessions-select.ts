import type { SessionSummary } from '@argus/shared-types'

export function adjacentSessions(
  sessions: SessionSummary[],
  currentId: string,
): { prev: SessionSummary | null; next: SessionSummary | null } {
  const i = sessions.findIndex((s) => s.id === currentId)
  if (i === -1) return { prev: null, next: null }
  return {
    prev: i > 0 ? sessions[i - 1]! : null,
    next: i < sessions.length - 1 ? sessions[i + 1]! : null,
  }
}

/** Duration label for a list row: dash when not ended, else ms / s / m+s. */
export function listDurationLabel(session: SessionSummary): string {
  if (!session.endedAt) return '—'
  const ms = new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime()
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const m = Math.floor(ms / 60_000)
  const sec = Math.round((ms % 60_000) / 1000)
  return `${m}m ${sec}s`
}
