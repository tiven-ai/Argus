export interface AuthUser {
  id: string
  email: string
  orgId: string
}

export interface AuthContext {
  user: AuthUser
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext
  }
}
