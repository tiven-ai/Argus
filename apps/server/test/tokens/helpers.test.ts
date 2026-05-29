import { describe, expect, it } from 'vitest'
import {
  generateToken,
  hashToken,
  parseAuthHeader,
  prefixForDisplay,
} from '../../src/modules/tokens/helpers.js'

describe('token helpers', () => {
  it('generateToken produces an argus_-prefixed 38-char string', () => {
    const t = generateToken()
    expect(t).toMatch(/^argus_[0-9a-f]{32}$/)
    expect(t).toHaveLength(38)
  })

  it('hashToken returns a 64-char hex sha256', () => {
    const t = 'argus_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    const h = hashToken(t)
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(hashToken(t)).toBe(h)
  })

  it('prefixForDisplay returns the first 12 chars', () => {
    expect(prefixForDisplay('argus_abcdef1234567890')).toBe('argus_abcdef')
  })

  it('parseAuthHeader extracts a bearer token', () => {
    expect(parseAuthHeader('Bearer argus_xxx')).toBe('argus_xxx')
    expect(parseAuthHeader('bearer argus_xxx')).toBe('argus_xxx')
    expect(parseAuthHeader('Token argus_xxx')).toBeNull()
    expect(parseAuthHeader(undefined)).toBeNull()
  })
})
