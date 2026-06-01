import { describe, expect, it } from 'vitest'
import { buildOpenApiDocument } from '../../src/openapi/registry.js'

// Minimal structural views of the generated document — the openapi3-ts types are
// too narrow to traverse ergonomically in assertions, so we read the few fields
// we assert on through these shapes (no `any`).
interface Param {
  name: string
}
interface Operation {
  requestBody?: { content: Record<string, { schema?: unknown }> }
  responses: Record<string, { content?: Record<string, { schema?: unknown }> }>
  parameters?: Param[]
}
type PathItem = Record<string, Operation>

describe('buildOpenApiDocument', () => {
  const doc = buildOpenApiDocument()
  const paths = (doc.paths ?? {}) as Record<string, PathItem>

  it('is a valid OpenAPI 3 document', () => {
    expect(doc.openapi).toMatch(/^3\./)
    expect(doc.info.title).toBeTruthy()
    expect(doc.info.version).toBeTruthy()
  })

  it('includes exactly the public-API paths', () => {
    expect(Object.keys(paths).sort()).toEqual([
      '/api/sessions',
      '/api/sessions/{sessionId}',
      '/healthz',
      '/v1/traces',
    ])
  })

  it('describes POST /v1/traces with a JSON request body', () => {
    const op = paths['/v1/traces']!.post!
    expect(op).toBeTruthy()
    expect(op.requestBody!.content['application/json']!.schema).toBeTruthy()
    expect(op.responses['200']).toBeTruthy()
  })

  it('describes GET /api/sessions with a 200 JSON response and query params', () => {
    const op = paths['/api/sessions']!.get!
    expect(op.responses['200']!.content!['application/json']!.schema).toBeTruthy()
    const names = (op.parameters ?? []).map((p) => p.name)
    expect(names).toContain('limit')
    expect(names).toContain('projectId')
  })

  it('describes GET /api/sessions/{sessionId} with a path param', () => {
    const op = paths['/api/sessions/{sessionId}']!.get!
    const names = (op.parameters ?? []).map((p) => p.name)
    expect(names).toContain('sessionId')
  })

  it('excludes internal endpoints (auth, projects, tokens, SSE stream)', () => {
    const keys = Object.keys(paths)
    expect(keys.some((p) => p.startsWith('/auth'))).toBe(false)
    expect(keys.some((p) => p.includes('/projects'))).toBe(false)
    expect(keys.some((p) => p.includes('/tokens'))).toBe(false)
    expect(keys.some((p) => p.includes('/stream'))).toBe(false)
  })
})
