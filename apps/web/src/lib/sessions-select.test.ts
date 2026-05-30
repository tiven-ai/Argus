import { describe, it, expect } from 'vitest'
import { filterSessionsByProject, adjacentSessions, listDurationLabel } from './sessions-select'
import type { SessionSummary } from '@argus/shared-types'

function s(partial: Partial<SessionSummary>): SessionSummary {
  return {
    id: 'id',
    traceId: 'trace',
    projectName: 'p',
    serviceName: 'svc',
    startedAt: '2026-05-30T00:00:00.000Z',
    endedAt: null,
    stepCount: 0,
    ...partial,
  }
}

describe('filterSessionsByProject', () => {
  const list = [s({ id: 'a', projectName: 'alpha' }), s({ id: 'b', projectName: 'beta' })]
  it('returns all when project is null', () => {
    expect(filterSessionsByProject(list, null).map((x) => x.id)).toEqual(['a', 'b'])
  })
  it('filters by project name', () => {
    expect(filterSessionsByProject(list, 'beta').map((x) => x.id)).toEqual(['b'])
  })
})

describe('adjacentSessions', () => {
  const list = [s({ id: 'a' }), s({ id: 'b' }), s({ id: 'c' })]
  it('finds prev and next by id', () => {
    expect(adjacentSessions(list, 'b')).toEqual({ prev: list[0], next: list[2] })
  })
  it('returns null at the ends', () => {
    expect(adjacentSessions(list, 'a').prev).toBeNull()
    expect(adjacentSessions(list, 'c').next).toBeNull()
  })
  it('returns nulls when id missing', () => {
    expect(adjacentSessions(list, 'z')).toEqual({ prev: null, next: null })
  })
})

describe('listDurationLabel', () => {
  it('returns dash when endedAt is null', () => {
    expect(listDurationLabel(s({ endedAt: null }))).toBe('—')
  })
  it('formats sub-second as ms', () => {
    expect(
      listDurationLabel(
        s({ startedAt: '2026-05-30T00:00:00.000Z', endedAt: '2026-05-30T00:00:00.420Z' }),
      ),
    ).toBe('420ms')
  })
  it('formats seconds with one decimal', () => {
    expect(
      listDurationLabel(
        s({ startedAt: '2026-05-30T00:00:00.000Z', endedAt: '2026-05-30T00:00:01.234Z' }),
      ),
    ).toBe('1.2s')
  })
  it('formats minutes', () => {
    expect(
      listDurationLabel(
        s({ startedAt: '2026-05-30T00:00:00.000Z', endedAt: '2026-05-30T00:01:35.000Z' }),
      ),
    ).toBe('1m 35s')
  })
})
