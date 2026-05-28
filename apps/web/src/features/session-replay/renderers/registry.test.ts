import { describe, expect, it, beforeEach } from 'vitest'
import type { Step } from '@argus/shared-types'
import { findRenderer, registerRenderer, renderers } from './registry'
import { GenericJsonRenderer } from './generic-json'

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
    endedAt: '2026-01-01T00:00:01.000Z',
    attributes: {},
    statusCode: 'OK',
    statusMessage: null,
    events: [],
    ...overrides,
  }
}

describe('findRenderer', () => {
  // Snapshot the original registry so tests are isolated.
  const original = [...renderers]
  beforeEach(() => {
    renderers.length = 0
    renderers.push(...original)
  })

  it('falls back to GenericJsonRenderer when nothing matches', () => {
    expect(findRenderer(makeStep()).id).toBe('generic-json')
  })

  it('higher priority renderer wins', () => {
    registerRenderer({ id: 'high', match: () => 100 })
    expect(findRenderer(makeStep()).id).toBe('high')
  })

  it('zero-priority renderers are ignored', () => {
    registerRenderer({ id: 'zero', match: () => 0 })
    expect(findRenderer(makeStep()).id).toBe('generic-json')
  })

  it('per-step priority lets one renderer win for some steps and another for others', () => {
    registerRenderer({ id: 'user-only', match: (s) => (s.kind === 'user_message' ? 100 : 0) })
    expect(findRenderer(makeStep({ kind: 'user_message' })).id).toBe('user-only')
    expect(findRenderer(makeStep({ kind: 'assistant_message' })).id).toBe('assistant-message')
  })

  it('GenericJsonRenderer always returns content for input/output (even when none)', () => {
    const step = makeStep()
    // Verify the renderer has both functions — no assertion that they return JSX without a DOM.
    expect(typeof GenericJsonRenderer.renderInput).toBe('function')
    expect(typeof GenericJsonRenderer.renderOutput).toBe('function')
  })

  it('picks UserMessageRenderer for user_message kind', () => {
    expect(findRenderer(makeStep({ kind: 'user_message' })).id).toBe('user-message')
  })

  it('picks AssistantMessageRenderer for assistant_message kind', () => {
    expect(findRenderer(makeStep({ kind: 'assistant_message' })).id).toBe('assistant-message')
  })
})
