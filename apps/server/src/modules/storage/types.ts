export interface NewStepEvent {
  name: string
  ts: Date
  attributes: Record<string, unknown>
}

export interface NewStep {
  spanId: string
  parentSpanId: string | null
  name: string
  kind: string | null
  componentType: string | null
  componentName: string | null
  startedAt: Date
  endedAt: Date
  attributes: Record<string, unknown>
  statusCode: 'UNSET' | 'OK' | 'ERROR'
  statusMessage: string | null
  events: NewStepEvent[]
}

export interface WriteTraceInput {
  orgId: string
  projectName: string
  serviceName: string
  traceId: string
  sessionStartedAt: Date
  sessionEndedAt: Date | null
  steps: NewStep[]
}

export interface StoredStepEvent {
  id: string
  name: string
  ts: Date
  attributes: Record<string, unknown>
}

export interface StoredStep {
  id: string
  spanId: string
  parentSpanId: string | null
  name: string
  kind: string | null
  componentType: string | null
  componentName: string | null
  startedAt: Date
  endedAt: Date
  attributes: Record<string, unknown>
  statusCode: string
  statusMessage: string | null
  events: StoredStepEvent[]
}

export interface StoredSessionSummary {
  id: string
  traceId: string
  projectName: string
  serviceName: string
  startedAt: Date
  endedAt: Date | null
  stepCount: number
}

export interface StoredSessionDetail extends StoredSessionSummary {
  steps: StoredStep[]
}

export interface WriteTraceResult {
  sessionId: string
  /** Steps that were inserted or updated by this call, ordered by started_at ASC. */
  writtenSteps: StoredStep[]
}

export interface StorageBackend {
  /**
   * Upserts project + service + session, then inserts steps (and their events).
   * Returns the session id and the steps that were written (with their DB ids
   * and updated step_event rows), so callers can publish them downstream.
   */
  writeTrace(input: WriteTraceInput): Promise<WriteTraceResult>

  /** Returns sessions for an org, most recently started first. */
  listSessions(opts: { orgId: string; limit?: number }): Promise<StoredSessionSummary[]>

  /** Returns one session with all its steps + step events, or null. */
  getSession(opts: { orgId: string; sessionId: string }): Promise<StoredSessionDetail | null>
}
