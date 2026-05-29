import { createHash, randomBytes } from 'node:crypto'

export function generateToken(): string {
  return `argus_${randomBytes(16).toString('hex')}`
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function prefixForDisplay(token: string): string {
  return token.slice(0, 12)
}

export function parseAuthHeader(header: string | undefined): string | null {
  if (!header) return null
  const m = /^Bearer\s+(.+)$/i.exec(header)
  return m ? m[1]!.trim() : null
}
