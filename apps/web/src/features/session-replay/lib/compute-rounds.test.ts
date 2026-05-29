import { describe, expect, it } from 'vitest'
import type { Step } from '@argus/shared-types'
import { computeRounds } from './compute-rounds'

function makeStep(overrides: Partial<Step> = {}): Step {
  return {
    id: overrides.id ?? overrides.spanId ?? Math.random().toString(36).slice(2),
    spanId: overrides.spanId ?? 'a'.repeat(16),
    parentSpanId: null,
    name: 'test',
    kind: null,
    componentType: null,
    componentName: null,
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: '2026-01-01T00:00:01.000Z',
    attributes: {},
    statusCode: 'OK',
    statusMessage: null,
    events: [],
    ...overrides,
  }
}

describe('computeRounds', () => {
  it('returns [] when there are no LLM calls', () => {
    const steps = [makeStep({ id: 'u', kind: 'user_message' })]
    expect(computeRounds(steps)).toEqual([])
  })

  it('returns one round per LLM call', () => {
    const steps = [
      makeStep({
        id: 'l1',
        kind: 'llm_call',
        startedAt: '2026-01-01T00:00:00Z',
        endedAt: '2026-01-01T00:00:01Z',
      }),
      makeStep({
        id: 'l2',
        kind: 'llm_call',
        startedAt: '2026-01-01T00:00:02Z',
        endedAt: '2026-01-01T00:00:03Z',
      }),
    ]
    const rounds = computeRounds(steps)
    expect(rounds.map((r) => r.id)).toEqual(['l1', 'l2'])
  })

  it('round.trigger is the most recent user_message before the LLM call', () => {
    const steps = [
      makeStep({
        id: 'u',
        kind: 'user_message',
        startedAt: '2026-01-01T00:00:00Z',
        endedAt: '2026-01-01T00:00:00Z',
      }),
      makeStep({
        id: 'sp',
        kind: 'system_prompt',
        startedAt: '2026-01-01T00:00:00.5Z',
        endedAt: '2026-01-01T00:00:00.5Z',
      }),
      makeStep({
        id: 'l1',
        kind: 'llm_call',
        startedAt: '2026-01-01T00:00:01Z',
        endedAt: '2026-01-01T00:00:02Z',
      }),
    ]
    const rounds = computeRounds(steps)
    expect(rounds).toHaveLength(1)
    expect(rounds[0]?.trigger?.id).toBe('u')
  })

  it("round 2's trigger is round 1's tool_call (not the original user_message)", () => {
    const steps = [
      makeStep({
        id: 'u',
        kind: 'user_message',
        startedAt: '2026-01-01T00:00:00Z',
        endedAt: '2026-01-01T00:00:00Z',
      }),
      makeStep({
        id: 'l1',
        kind: 'llm_call',
        startedAt: '2026-01-01T00:00:01Z',
        endedAt: '2026-01-01T00:00:02Z',
      }),
      makeStep({
        id: 't1',
        kind: 'tool_call',
        startedAt: '2026-01-01T00:00:03Z',
        endedAt: '2026-01-01T00:00:04Z',
      }),
      makeStep({
        id: 'l2',
        kind: 'llm_call',
        startedAt: '2026-01-01T00:00:05Z',
        endedAt: '2026-01-01T00:00:06Z',
      }),
    ]
    const rounds = computeRounds(steps)
    expect(rounds).toHaveLength(2)
    expect(rounds[0]?.trigger?.id).toBe('u')
    expect(rounds[1]?.trigger?.id).toBe('t1')
  })

  it('round.toolExecutions includes only tool_calls between this and next LLM call', () => {
    const steps = [
      makeStep({
        id: 'l1',
        kind: 'llm_call',
        startedAt: '2026-01-01T00:00:00Z',
        endedAt: '2026-01-01T00:00:01Z',
      }),
      makeStep({
        id: 't1',
        kind: 'tool_call',
        startedAt: '2026-01-01T00:00:02Z',
        endedAt: '2026-01-01T00:00:03Z',
      }),
      makeStep({
        id: 't2',
        kind: 'tool_call',
        startedAt: '2026-01-01T00:00:03.5Z',
        endedAt: '2026-01-01T00:00:04Z',
      }),
      makeStep({
        id: 'l2',
        kind: 'llm_call',
        startedAt: '2026-01-01T00:00:05Z',
        endedAt: '2026-01-01T00:00:06Z',
      }),
      makeStep({
        id: 't3',
        kind: 'tool_call',
        startedAt: '2026-01-01T00:00:07Z',
        endedAt: '2026-01-01T00:00:08Z',
      }),
    ]
    const rounds = computeRounds(steps)
    expect(rounds[0]?.toolExecutions.map((s) => s.id)).toEqual(['t1', 't2'])
    expect(rounds[1]?.toolExecutions.map((s) => s.id)).toEqual(['t3'])
  })

  it('treats componentType=llm as an LLM call even if kind is null', () => {
    const steps = [
      makeStep({
        id: 'l1',
        kind: null,
        componentType: 'llm',
        startedAt: '2026-01-01T00:00:00Z',
        endedAt: '2026-01-01T00:00:01Z',
      }),
    ]
    const rounds = computeRounds(steps)
    expect(rounds).toHaveLength(1)
    expect(rounds[0]?.id).toBe('l1')
  })

  it('handles input order regardless (uses startedAt for ordering)', () => {
    const steps = [
      makeStep({
        id: 'l2',
        kind: 'llm_call',
        startedAt: '2026-01-01T00:00:05Z',
        endedAt: '2026-01-01T00:00:06Z',
      }),
      makeStep({
        id: 'l1',
        kind: 'llm_call',
        startedAt: '2026-01-01T00:00:00Z',
        endedAt: '2026-01-01T00:00:01Z',
      }),
      makeStep({
        id: 'u',
        kind: 'user_message',
        startedAt: '2026-01-01T00:00:00Z',
        endedAt: '2026-01-01T00:00:00Z',
      }),
    ]
    const rounds = computeRounds(steps)
    expect(rounds.map((r) => r.id)).toEqual(['l1', 'l2'])
  })
})
