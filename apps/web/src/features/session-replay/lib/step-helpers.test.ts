import { describe, expect, it } from 'vitest'
import type { Step } from '@argus/shared-types'
import {
  durationMs,
  findEvent,
  formatDuration,
  sessionDurationMs,
  sessionStatus,
  sessionTokens,
  tokenUsage,
} from './step-helpers'

function makeStep(overrides: Partial<Step> = {}): Step {
  return {
    id: 'x',
    spanId: 'a'.repeat(16),
    parentSpanId: null,
    name: 'test',
    kind: null,
    componentType: null,
    componentName: null,
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: '2026-01-01T00:00:01.500Z',
    attributes: {},
    statusCode: 'OK',
    statusMessage: null,
    events: [],
    ...overrides,
  }
}

describe('step-helpers', () => {
  it('findEvent returns the matching event or undefined', () => {
    const step = makeStep({
      events: [
        { id: 'e1', name: 'argus.input', ts: '2026-01-01T00:00:00.5Z', attributes: { x: 1 } },
      ],
    })
    expect(findEvent(step, 'argus.input')?.attributes).toEqual({ x: 1 })
    expect(findEvent(step, 'argus.output')).toBeUndefined()
  })

  it('durationMs computes endedAt - startedAt in ms', () => {
    expect(durationMs(makeStep())).toBe(1500)
  })

  it('formatDuration produces ms / s / m s output', () => {
    expect(formatDuration(45)).toBe('45ms')
    expect(formatDuration(1500)).toBe('1.50s')
    expect(formatDuration(75_000)).toBe('1m 15s')
  })

  it('tokenUsage reads gen_ai.usage attributes or returns null', () => {
    expect(tokenUsage(makeStep())).toBeNull()
    const step = makeStep({
      attributes: { 'gen_ai.usage.input_tokens': 100, 'gen_ai.usage.output_tokens': 40 },
    })
    expect(tokenUsage(step)).toEqual({ input: 100, output: 40 })
  })

  it('sessionTokens sums across steps', () => {
    const s1 = makeStep({
      attributes: { 'gen_ai.usage.input_tokens': 10, 'gen_ai.usage.output_tokens': 5 },
    })
    const s2 = makeStep({
      attributes: { 'gen_ai.usage.input_tokens': 20, 'gen_ai.usage.output_tokens': 8 },
    })
    expect(sessionTokens([s1, s2, makeStep()])).toEqual({ input: 30, output: 13 })
  })

  it('sessionDurationMs covers earliest startedAt to latest endedAt', () => {
    const a = makeStep({ startedAt: '2026-01-01T00:00:00Z', endedAt: '2026-01-01T00:00:01Z' })
    const b = makeStep({ startedAt: '2026-01-01T00:00:02Z', endedAt: '2026-01-01T00:00:05Z' })
    expect(sessionDurationMs([a, b])).toBe(5000)
    expect(sessionDurationMs([])).toBe(0)
  })

  it('sessionStatus is ERROR if any step is ERROR, OK if all OK, otherwise UNSET', () => {
    expect(sessionStatus([makeStep({ statusCode: 'OK' })])).toBe('OK')
    expect(sessionStatus([makeStep({ statusCode: 'OK' }), makeStep({ statusCode: 'ERROR' })])).toBe(
      'ERROR',
    )
    expect(sessionStatus([makeStep({ statusCode: 'UNSET' })])).toBe('UNSET')
  })
})
