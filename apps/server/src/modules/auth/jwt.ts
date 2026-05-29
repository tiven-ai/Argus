import jwt from 'jsonwebtoken'

export interface JwtPayload {
  userId: string
}

export function signJwt(payload: JwtPayload, secret: string, expiresInSeconds: number): string {
  return jwt.sign(payload, secret, { algorithm: 'HS256', expiresIn: expiresInSeconds })
}

export function verifyJwt(token: string, secret: string): JwtPayload | null {
  try {
    const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] })
    if (typeof decoded !== 'object' || decoded === null) return null
    const { userId } = decoded as { userId?: unknown }
    if (typeof userId !== 'string') return null
    return { userId }
  } catch {
    return null
  }
}
