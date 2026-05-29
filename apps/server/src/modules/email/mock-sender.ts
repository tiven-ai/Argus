import type { EmailMessage, EmailSender } from './types.js'

/**
 * Collects sent messages in memory; tests assert on `sender.sent`.
 * Optionally `throwOnSend` simulates Resend outage for register-resilience tests.
 */
export class MockEmailSender implements EmailSender {
  public sent: EmailMessage[] = []
  public throwOnSend = false
  async send(msg: EmailMessage): Promise<void> {
    if (this.throwOnSend) throw new Error('mock_resend_outage')
    this.sent.push(msg)
  }
}
