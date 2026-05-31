import { describe, expect, it } from 'vitest'
import type { Step } from '@argus/shared-types'
import { classifyExecutions } from './classify-execution'

function makeStep(overrides: Partial<Step> = {}): Step {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    spanId: 'a'.repeat(16),
    parentSpanId: null,
    name: overrides.name ?? 'test',
    kind: overrides.kind ?? 'tool_call',
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

describe('classifyExecutions', () => {
  it('returns [] for empty input', () => {
    expect(classifyExecutions([])).toEqual([])
  })

  it('classifies custom_tool / skill / middleware / unknown / missing as internal', () => {
    const steps = [
      makeStep({ id: 'a', componentType: 'custom_tool' }),
      makeStep({ id: 'b', componentType: 'skill' }),
      makeStep({ id: 'c', componentType: 'middleware' }),
      makeStep({ id: 'd', componentType: 'something_else' }),
      makeStep({ id: 'e', componentType: null }),
    ]
    const groups = classifyExecutions(steps)
    expect(groups).toHaveLength(1)
    expect(groups[0]?.category).toBe('internal')
    expect(groups[0]?.steps.map((s) => s.id)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('classifies external_resource / mcp as external and sub-categorizes by name', () => {
    const steps = [
      makeStep({ id: 'kb', componentType: 'external_resource', componentName: 'knowledge_search' }),
      makeStep({ id: 'mem', componentType: 'external_resource', componentName: 'memory_recall' }),
      makeStep({ id: 'db', componentType: 'mcp', componentName: 'run_sql_query' }),
      makeStep({ id: 'http', componentType: 'external_resource', componentName: 'http_fetch' }),
      makeStep({ id: 'misc', componentType: 'external_resource', componentName: 'do_thing' }),
    ]
    const groups = classifyExecutions(steps)
    const byCat = Object.fromEntries(groups.map((g) => [g.category, g.steps.map((s) => s.id)]))
    expect(byCat).toEqual({
      knowledge: ['kb'],
      memory: ['mem'],
      database: ['db'],
      http: ['http'],
      other: ['misc'],
    })
  })

  it('falls back to step.name when componentName is null', () => {
    const steps = [
      makeStep({
        id: 'x',
        componentType: 'external_resource',
        componentName: null,
        name: 'vector_lookup',
      }),
    ]
    const groups = classifyExecutions(steps)
    expect(groups[0]?.category).toBe('knowledge')
  })

  it('orders groups: internal first, then knowledge→memory→database→http→other', () => {
    const steps = [
      makeStep({ id: 'http', componentType: 'external_resource', componentName: 'api_call' }),
      makeStep({ id: 'misc', componentType: 'external_resource', componentName: 'do_thing' }),
      makeStep({ id: 'kb', componentType: 'external_resource', componentName: 'rag_search' }),
      makeStep({ id: 'int', componentType: 'custom_tool', componentName: 'get_weather' }),
      makeStep({ id: 'db', componentType: 'external_resource', componentName: 'postgres_select' }),
      makeStep({ id: 'mem', componentType: 'external_resource', componentName: 'recall_fact' }),
    ]
    const groups = classifyExecutions(steps)
    expect(groups.map((g) => g.category)).toEqual([
      'internal',
      'knowledge',
      'memory',
      'database',
      'http',
      'other',
    ])
  })

  it('omits empty groups', () => {
    const steps = [makeStep({ id: 'int', componentType: 'custom_tool' })]
    const groups = classifyExecutions(steps)
    expect(groups.map((g) => g.category)).toEqual(['internal'])
  })
})
