import { describe, expect, test } from 'vitest'
import { MockEmailSender } from '../../src/modules/email/index.js'

describe('MockEmailSender', () => {
  test('collects sent messages', async () => {
    const sender = new MockEmailSender()
    await sender.send({ to: 'a@a.com', subject: 's', html: 'h', text: 't' })
    expect(sender.sent).toHaveLength(1)
    expect(sender.sent[0]!.to).toBe('a@a.com')
  })

  test('throws when throwOnSend is set', async () => {
    const sender = new MockEmailSender()
    sender.throwOnSend = true
    await expect(
      sender.send({ to: 'a@a.com', subject: 's', html: 'h', text: 't' }),
    ).rejects.toThrow('mock_resend_outage')
  })
})
