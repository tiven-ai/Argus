import { describe, expect, it } from 'vitest'
import { formatSseEvent, formatSseComment } from '../../src/modules/pusher/sse.js'

describe('formatSseEvent', () => {
  it('emits id + data lines + terminator', () => {
    const out = formatSseEvent('step-id-1', { type: 'step', step: { id: 'x' } })
    expect(out).toBe('id: step-id-1\ndata: {"type":"step","step":{"id":"x"}}\n\n')
  })

  it('encodes id-less events', () => {
    const out = formatSseEvent(undefined, { type: 'init' })
    expect(out).toBe('data: {"type":"init"}\n\n')
  })

  it('does not contain unescaped CR or LF in the data field', () => {
    const out = formatSseEvent('id', { text: 'line1\nline2' })
    // The data line itself has no literal newline outside the framing — the
    // JSON encoding escapes \n inside the string.
    const dataLine = out.split('\n').find((l) => l.startsWith('data: '))!
    expect(dataLine.includes('\\n')).toBe(true)
    expect(dataLine.split('\n')).toHaveLength(1)
  })
})

describe('formatSseComment', () => {
  it('emits a comment-prefixed line with terminator', () => {
    expect(formatSseComment('heartbeat')).toBe(': heartbeat\n\n')
  })
})
