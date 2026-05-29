export interface AuthUser {
  id: string
  email: string
  orgId: string
  emailVerifiedAt: string | null
}

export interface AuthContext {
  user: AuthUser
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext
  }
}
