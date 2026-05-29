import { describe, expect, test } from 'vitest'
import en from './locales/en.json'
import zhCN from './locales/zh-CN.json'
import ja from './locales/ja.json'

function flatten(o: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(o).flatMap(([k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k
    return v && typeof v === 'object' ? flatten(v as Record<string, unknown>, key) : [key]
  })
}

describe('locale parity', () => {
  const enKeys = new Set(flatten(en as Record<string, unknown>))
  test('zh-CN matches en key set', () => {
    expect(new Set(flatten(zhCN as Record<string, unknown>))).toEqual(enKeys)
  })
  test('ja matches en key set', () => {
    expect(new Set(flatten(ja as Record<string, unknown>))).toEqual(enKeys)
  })
})
