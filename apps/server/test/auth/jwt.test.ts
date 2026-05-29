import { describe, expect, it } from 'vitest'
import { signJwt, verifyJwt } from '../../src/modules/auth/jwt.js'

const SECRET = 'test-secret-xxxxxxxxxxxxxxxxxxxxxxxxxxxx'

describe('jwt helpers', () => {
  it('signJwt + verifyJwt round-trip returns the original payload', () => {
    const token = signJwt({ userId: 'u1' }, SECRET, 3600)
    expect(verifyJwt(token, SECRET)).toEqual(expect.objectContaining({ userId: 'u1' }))
  })

  it('verifyJwt returns null for an invalid signature', () => {
    const token = signJwt({ userId: 'u1' }, SECRET, 3600)
    expect(verifyJwt(token + 'tamper', SECRET)).toBeNull()
  })

  it('verifyJwt returns null for a token signed with a different secret', () => {
    const token = signJwt({ userId: 'u1' }, SECRET, 3600)
    expect(verifyJwt(token, 'other-secret-xxxxxxxxxxxxxxxxxxxxxxxxxx')).toBeNull()
  })

  it('verifyJwt returns null when token is expired', () => {
    const token = signJwt({ userId: 'u1' }, SECRET, -1) // already expired
    expect(verifyJwt(token, SECRET)).toBeNull()
  })
})
