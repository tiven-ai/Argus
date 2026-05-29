import type { Kysely } from 'kysely'
import type { DB } from '../../db/schema.js'
import { generateRawToken, issueToken, revokeAllForUserKind } from '../auth-tokens/index.js'
import type { EmailSender } from '../email/index.js'
import { templates } from '../email/index.js'

export interface EmailFlowsDeps {
  db: Kysely<DB>
  emailSender: EmailSender
  appBaseUrl: string
}

/** Revoke prior verify tokens, issue new, send verification email. */
export async function issueAndSendEmailVerify(
  deps: EmailFlowsDeps,
  args: { userId: string; email: string },
): Promise<void> {
  await revokeAllForUserKind(deps.db, args.userId, 'email_verify')
  const raw = generateRawToken('email_verify')
  await issueToken(deps.db, { userId: args.userId, kind: 'email_verify', rawToken: raw })
  const url = `${deps.appBaseUrl}/auth/verify-email?token=${encodeURIComponent(raw)}`
  const msg = templates.emailVerifyTemplate(url)
  await deps.emailSender.send({ to: args.email, ...msg })
}

/** Revoke prior reset tokens, issue new, send reset email. */
export async function issueAndSendPasswordReset(
  deps: EmailFlowsDeps,
  args: { userId: string; email: string },
): Promise<void> {
  await revokeAllForUserKind(deps.db, args.userId, 'password_reset')
  const raw = generateRawToken('password_reset')
  await issueToken(deps.db, { userId: args.userId, kind: 'password_reset', rawToken: raw })
  const url = `${deps.appBaseUrl}/auth/reset-password?token=${encodeURIComponent(raw)}`
  const msg = templates.passwordResetTemplate(url)
  await deps.emailSender.send({ to: args.email, ...msg })
}

/** Send the courtesy "password changed" notification (no link). */
export async function sendPasswordChanged(
  deps: Pick<EmailFlowsDeps, 'emailSender'>,
  args: { email: string; at: Date; ip?: string },
): Promise<void> {
  const msg = templates.passwordChangedTemplate(args.at, args.ip)
  await deps.emailSender.send({ to: args.email, ...msg })
}
