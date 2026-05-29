export type AuditEventType = 'login_success' | 'register' | 'token_create' | 'token_revoke'

export interface RecordArgs {
  eventType: AuditEventType
  actorUserId: string | null
  targetKind?: string
  targetId?: string
  metadata?: Record<string, unknown>
  ip?: string
  userAgent?: string
}
