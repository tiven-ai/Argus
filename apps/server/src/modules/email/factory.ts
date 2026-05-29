import { ResendEmailSender } from './resend-sender.js'
import type { EmailSender } from './types.js'

export function makeEmailSender(opts: { resendApiKey?: string; from: string }): EmailSender {
  if (!opts.resendApiKey) {
    throw new Error('RESEND_API_KEY not configured')
  }
  return new ResendEmailSender(opts.resendApiKey, opts.from)
}
