import jwt from 'jsonwebtoken'

export interface SessionPayload {
  userId: string
  pv: number
}

export function signJwt(payload: SessionPayload, secret: string, expiresInSeconds: number): string {
  return jwt.sign(payload, secret, { algorithm: 'HS256', expiresIn: expiresInSeconds })
}

export function verifyJwt(token: string, secret: string): SessionPayload | null {
  try {
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] })
    if (typeof decoded !== 'object' || decoded === null) return null
    const { userId, pv } = decoded as { userId?: unknown; pv?: unknown }
    if (typeof userId !== 'string') return null
    if (typeof pv !== 'number') return null
    return { userId, pv }
  } catch {
    return null
  }
}
