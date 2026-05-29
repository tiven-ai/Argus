import { describe, expect, test, vi, beforeEach } from 'vitest'
import { ResendEmailSender } from '../../src/modules/email/resend-sender.js'

const send = vi.fn()
vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: { send },
  })),
}))

describe('ResendEmailSender', () => {
  beforeEach(() => {
    send.mockReset()
  })

  test('calls Resend.emails.send with mapped fields', async () => {
    send.mockResolvedValue({ data: { id: 'abc' }, error: null })
    const sender = new ResendEmailSender('rs_test_key', 'Argus <noreply@argus.dev>')
    await sender.send({
      to: 'user@example.com',
      subject: 'hi',
      html: '<p>hi</p>',
      text: 'hi',
    })
    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith({
      from: 'Argus <noreply@argus.dev>',
      to: 'user@example.com',
      subject: 'hi',
      html: '<p>hi</p>',
      text: 'hi',
    })
  })

  test('throws when Resend returns an error', async () => {
    send.mockResolvedValue({
      data: null,
      error: { message: 'invalid_to', name: 'validation_error' },
    })
    const sender = new ResendEmailSender('rs_test_key', 'Argus <noreply@argus.dev>')
    await expect(sender.send({ to: 'broken', subject: 's', html: 'h', text: 't' })).rejects.toThrow(
      /resend_send_failed: invalid_to/,
    )
  })
})
