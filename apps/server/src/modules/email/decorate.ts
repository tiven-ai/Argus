import type { EmailSender } from './types.js'

declare module 'fastify' {
  interface FastifyInstance {
    emailSender: EmailSender
  }
}
