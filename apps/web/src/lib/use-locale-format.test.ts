import { describe, expect, test } from 'vitest'

describe('Intl.DateTimeFormat (underlying useLocaleFormat behavior)', () => {
  test('en and zh-CN produce different formatted output for same date', () => {
    const d = new Date('2026-05-29T10:30:00Z')
    const en = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(d)
    const zh = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(
      d,
    )
    expect(en).not.toBe(zh)
  })
  test('Intl.NumberFormat en groups thousands with comma', () => {
    expect(new Intl.NumberFormat('en').format(1234567)).toBe('1,234,567')
  })
})
