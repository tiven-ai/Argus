import { createHash, randomBytes } from 'node:crypto'
import type { TokenKind } from './types.js'

const PREFIX: Record<TokenKind, string> = {
  email_verify: 'verify',
  password_reset: 'reset',
}

export function generateRawToken(kind: TokenKind): string {
  return `${PREFIX[kind]}_${randomBytes(32).toString('hex')}`
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}
