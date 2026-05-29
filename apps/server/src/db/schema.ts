import type { ColumnType, Generated } from 'kysely'

type Timestamp = ColumnType<Date, Date | string, Date | string>
type Json = ColumnType<unknown, string, string>

export interface Orgs {
  id: string
  name: string
  created_at: Generated<Timestamp>
}

export interface Projects {
  id: Generated<string>
  org_id: string
  name: string
  created_at: Generated<Timestamp>
}

export interface Services {
  id: Generated<string>
  project_id: string
  name: string
  created_at: Generated<Timestamp>
}

export interface Sessions {
  id: Generated<string>
  service_id: string
  org_id: string
  trace_id: string
  started_at: Timestamp
  ended_at: Timestamp | null
  step_count: Generated<number>
}

export interface Steps {
  id: Generated<string>
  session_id: string
  org_id: string
  span_id: string
  parent_span_id: string | null
  name: string
  kind: string | null
  component_type: string | null
  component_name: string | null
  started_at: Timestamp
  ended_at: Timestamp
  attributes: Json
  status_code: Generated<string>
  status_message: string | null
}

export interface StepEvents {
  id: Generated<string>
  step_id: string
  org_id: string
  name: string
  ts: Timestamp
  attributes: Json
}

export interface Users {
  id: Generated<string>
  email: string
  password_hash: string
  created_at: Generated<Timestamp>
}

export interface OrgMembers {
  user_id: string
  org_id: string
  role: Generated<string>
  created_at: Generated<Timestamp>
}

export interface IngestTokens {
  id: Generated<string>
  project_id: string
  name: string
  token_prefix: string
  token_hash: string
  created_at: Generated<Timestamp>
  revoked_at: Timestamp | null
}

export interface AuditLog {
  id: Generated<string>
  timestamp: Generated<Timestamp>
  org_id: string
  actor_user_id: string | null
  event_type: string
  target_kind: string | null
  target_id: string | null
  metadata: Json | null
  ip: string | null
  user_agent: string | null
}

export interface DB {
  orgs: Orgs
  projects: Projects
  services: Services
  sessions: Sessions
  steps: Steps
  step_events: StepEvents
  users: Users
  org_members: OrgMembers
  ingest_tokens: IngestTokens
  audit_log: AuditLog
}
