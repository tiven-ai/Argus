import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { otlpExportRequestSchema, parseOtlpRequest } from '../../src/modules/ingest/index.js'

// This test file lives at apps/server/test/docs/; the repo root is four levels up.
const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '../../../..')
const examplePath = resolve(repoRoot, 'scripts/example-trace.json')
const guidePath = resolve(repoRoot, 'docs/integration/sending-traces.md')

describe('docs: example-trace.json stays valid and in sync with the integration guide', () => {
  it('is a valid OTLP request the real parser accepts', () => {
    const json = JSON.parse(readFileSync(examplePath, 'utf8'))
    const parsed = otlpExportRequestSchema.parse(json) // throws if the schema moved on
    const results = parseOtlpRequest(parsed)
    const spanCount = results.reduce((n, r) => n + r.steps.length, 0)
    expect(spanCount).toBeGreaterThan(0)
  })

  it('matches the accepted count documented in the integration guide', () => {
    const json = JSON.parse(readFileSync(examplePath, 'utf8'))
    const parsed = otlpExportRequestSchema.parse(json)
    const actualSpanCount = parseOtlpRequest(parsed).reduce((n, r) => n + r.steps.length, 0)

    const md = readFileSync(guidePath, 'utf8')
    // The guide shows the success body once as `{ "accepted": <number> }`.
    // The at-a-glance table uses `<span-count>` (non-numeric) and is not matched.
    const matches = [...md.matchAll(/"accepted"\s*:\s*(\d+)/g)]
    expect(matches).toHaveLength(1)
    const documented = Number(matches[0]![1])

    expect(documented).toBe(actualSpanCount)
  })
})
