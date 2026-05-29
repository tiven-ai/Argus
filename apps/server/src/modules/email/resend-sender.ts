import { Resend } from 'resend'
import type { EmailMessage, EmailSender } from './types.js'

export class ResendEmailSender implements EmailSender {
  private client: Resend
  constructor(
    private apiKey: string,
    private from: string,
  ) {
    this.client = new Resend(apiKey)
  }
  async send(msg: EmailMessage): Promise<void> {
    const { error } = await this.client.emails.send({
      from: this.from,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    })
    if (error) {
      throw new Error(`resend_send_failed: ${error.message}`)
    }
  }
}
