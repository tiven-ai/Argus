export type TokenKind = 'email_verify' | 'password_reset'

export interface TokenRecord {
  id: string
  userId: string
  kind: TokenKind
  expiresAt: Date
  consumedAt: Date | null
  createdAt: Date
}
