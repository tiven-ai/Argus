import { describe, it, expect } from 'vitest'
import { MODULE_NAV, SETTINGS_NAV } from './nav-config'

describe('nav config', () => {
  it('only Sessions is enabled among modules', () => {
    expect(MODULE_NAV.filter((n) => !n.soon).map((n) => n.key)).toEqual(['sessions'])
  })
  it('marks monitoring, analytics, evals as soon', () => {
    expect(MODULE_NAV.filter((n) => n.soon).map((n) => n.key)).toEqual([
      'monitoring',
      'analytics',
      'evals',
    ])
  })
  it('only Tokens is enabled among settings children', () => {
    expect(SETTINGS_NAV.filter((n) => !n.soon).map((n) => n.key)).toEqual(['tokens'])
  })
})
