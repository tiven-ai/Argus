import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from '../../src/modules/auth/password.js'

describe('password helpers', () => {
  it('hashPassword returns a non-empty bcrypt-shaped string', async () => {
    const hash = await hashPassword('hunter2')
    expect(hash).toMatch(/^\$2[aby]\$\d{2}\$/)
  })

  it('verifyPassword returns true for the correct password', async () => {
    const hash = await hashPassword('hunter2')
    expect(await verifyPassword('hunter2', hash)).toBe(true)
  })

  it('verifyPassword returns false for the wrong password', async () => {
    const hash = await hashPassword('hunter2')
    expect(await verifyPassword('wrong', hash)).toBe(false)
  })

  it('verifyPassword returns false for the local-user sentinel hash', async () => {
    expect(await verifyPassword('anything', '$local$')).toBe(false)
  })
})
