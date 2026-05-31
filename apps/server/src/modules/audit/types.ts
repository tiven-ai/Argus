export type AuditEventType =
  | 'login_success'
  | 'register'
  | 'token_create'
  | 'token_revoke'
  | 'project_create'
  | 'project_rename'
  | 'project_delete'

export interface RecordArgs {
  eventType: AuditEventType
  actorUserId: string | null
  targetKind?: string
  targetId?: string
  metadata?: Record<string, unknown>
  ip?: string
  userAgent?: string
}
