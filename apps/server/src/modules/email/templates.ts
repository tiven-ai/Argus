import type { EmailMessage } from './types.js'

const FOOTER_HTML = `<p style="color:#888;font-size:12px;margin-top:24px">If this wasn't you, please ignore this message.</p>`
const FOOTER_TEXT = `\n\nIf this wasn't you, please ignore this message.`

export function emailVerifyTemplate(verifyUrl: string): Omit<EmailMessage, 'to'> {
  return {
    subject: 'Verify your Argus account',
    html: `<div style="font-family:sans-serif;font-size:14px;line-height:1.5">
  <p>Welcome to Argus. Verify your email address to confirm your account:</p>
  <p><a href="${verifyUrl}" style="display:inline-block;padding:8px 16px;background:#0a84ff;color:white;text-decoration:none;border-radius:4px">Verify email</a></p>
  <p>Or paste this link into your browser:<br><code style="word-break:break-all">${verifyUrl}</code></p>
  ${FOOTER_HTML}
</div>`,
    text: `Welcome to Argus. Verify your email at: ${verifyUrl}${FOOTER_TEXT}`,
  }
}

export function passwordResetTemplate(resetUrl: string): Omit<EmailMessage, 'to'> {
  return {
    subject: 'Reset your Argus password',
    html: `<div style="font-family:sans-serif;font-size:14px;line-height:1.5">
  <p>We received a request to reset your Argus password. Click below to set a new one (the link expires in 1 hour):</p>
  <p><a href="${resetUrl}" style="display:inline-block;padding:8px 16px;background:#0a84ff;color:white;text-decoration:none;border-radius:4px">Reset password</a></p>
  <p>Or paste this link into your browser:<br><code style="word-break:break-all">${resetUrl}</code></p>
  ${FOOTER_HTML}
</div>`,
    text: `Reset your Argus password at (expires in 1 hour): ${resetUrl}${FOOTER_TEXT}`,
  }
}

export function passwordChangedTemplate(
  at: Date,
  ip: string | undefined,
): Omit<EmailMessage, 'to'> {
  const when = at.toISOString()
  const where = ip ? ` from IP ${ip}` : ''
  return {
    subject: 'Your Argus password was changed',
    html: `<div style="font-family:sans-serif;font-size:14px;line-height:1.5">
  <p>Your Argus password was changed on ${when}${where}.</p>
  <p>If this wasn't you, request a new reset link and contact your administrator.</p>
</div>`,
    text: `Your Argus password was changed on ${when}${where}. If this wasn't you, request a new reset link and contact your administrator.`,
  }
}
