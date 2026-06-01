import { describe, expect, it } from 'vitest'
import { buildOpenApiDocument } from '../../src/openapi/registry.js'

describe('buildOpenApiDocument', () => {
  const doc = buildOpenApiDocument()

  it('is a valid OpenAPI 3 document', () => {
    expect(doc.openapi).toMatch(/^3\./)
    expect(doc.info.title).toBeTruthy()
    expect(doc.info.version).toBeTruthy()
  })

  it('includes exactly the public-API paths', () => {
    expect(Object.keys(doc.paths ?? {}).sort()).toEqual([
      '/api/sessions',
      '/api/sessions/{sessionId}',
      '/healthz',
      '/v1/traces',
    ])
  })

  it('describes POST /v1/traces with a JSON request body', () => {
    const op = (doc.paths!['/v1/traces'] as Record<string, any>).post
    expect(op).toBeTruthy()
    expect(op.requestBody.content['application/json'].schema).toBeTruthy()
    expect(op.responses['200']).toBeTruthy()
  })

  it('describes GET /api/sessions with a 200 JSON response and query params', () => {
    const op = (doc.paths!['/api/sessions'] as Record<string, any>).get
    expect(op.responses['200'].content['application/json'].schema).toBeTruthy()
    const names = (op.parameters ?? []).map((p: any) => p.name)
    expect(names).toContain('limit')
    expect(names).toContain('projectId')
  })

  it('describes GET /api/sessions/{sessionId} with a path param', () => {
    const op = (doc.paths!['/api/sessions/{sessionId}'] as Record<string, any>).get
    const names = (op.parameters ?? []).map((p: any) => p.name)
    expect(names).toContain('sessionId')
  })

  it('excludes internal endpoints (auth, projects, tokens, SSE stream)', () => {
    const paths = Object.keys(doc.paths ?? {})
    expect(paths.some((p) => p.startsWith('/auth'))).toBe(false)
    expect(paths.some((p) => p.includes('/projects'))).toBe(false)
    expect(paths.some((p) => p.includes('/tokens'))).toBe(false)
    expect(paths.some((p) => p.includes('/stream'))).toBe(false)
  })
})
