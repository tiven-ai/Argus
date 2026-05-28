import { describe, expect, it } from 'vitest'
import { otlpExportRequestSchema } from '../../src/modules/ingest/otlp-json.js'
import { OtlpParseError, parseOtlpRequest } from '../../src/modules/ingest/parser.js'

const HEX_TRACE = '0123456789abcdef0123456789abcdef'
const HEX_SPAN_A = 'aaaaaaaaaaaaaaaa'
const HEX_SPAN_B = 'bbbbbbbbbbbbbbbb'

function makeRequest(overrides: { resourceAttrs?: Array<{ key: string; value: unknown }> } = {}) {
  return otlpExportRequestSchema.parse({
    resourceSpans: [
      {
        resource: {
          attributes: overrides.resourceAttrs ?? [
            { key: 'argus.project', value: { stringValue: 'p1' } },
            { key: 'argus.service', value: { stringValue: 's1' } },
          ],
        },
        scopeSpans: [
          {
            spans: [
              {
                traceId: HEX_TRACE,
                spanId: HEX_SPAN_A,
                name: 'agent.session',
                startTimeUnixNano: '1779955200000000000',
                endTimeUnixNano: '1779955205000000000',
                attributes: [{ key: 'argus.step.kind', value: { stringValue: 'user_message' } }],
                events: [
                  {
                    timeUnixNano: '1779955200500000000',
                    name: 'argus.input',
                    attributes: [{ key: 'text', value: { stringValue: 'hello' } }],
                  },
                ],
                status: { code: 1 },
              },
            ],
          },
        ],
      },
    ],
  })
}

describe('parseOtlpRequest', () => {
  it('extracts project, service, and step from a minimal payload', () => {
    const result = parseOtlpRequest(makeRequest())
    expect(result).toHaveLength(1)
    expect(result[0]?.projectName).toBe('p1')
    expect(result[0]?.serviceName).toBe('s1')
    expect(result[0]?.traceId).toBe(HEX_TRACE)
    expect(result[0]?.steps).toHaveLength(1)
    expect(result[0]?.steps[0]?.kind).toBe('user_message')
    expect(result[0]?.steps[0]?.statusCode).toBe('OK')
    expect(result[0]?.steps[0]?.events).toHaveLength(1)
    expect(result[0]?.steps[0]?.events[0]?.attributes).toEqual({ text: 'hello' })
  })

  it('errors when argus.project is missing', () => {
    expect(() =>
      parseOtlpRequest(
        makeRequest({
          resourceAttrs: [{ key: 'argus.service', value: { stringValue: 's1' } }],
        }),
      ),
    ).toThrow(OtlpParseError)
  })

  it('falls back to service.name when argus.service is absent', () => {
    const result = parseOtlpRequest(
      makeRequest({
        resourceAttrs: [
          { key: 'argus.project', value: { stringValue: 'p1' } },
          { key: 'service.name', value: { stringValue: 'fallback' } },
        ],
      }),
    )
    expect(result[0]?.serviceName).toBe('fallback')
  })

  it('merges multiple spans of the same trace into one ParsedTrace', () => {
    const req = otlpExportRequestSchema.parse({
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: 'argus.project', value: { stringValue: 'p1' } },
              { key: 'argus.service', value: { stringValue: 's1' } },
            ],
          },
          scopeSpans: [
            {
              spans: [
                {
                  traceId: HEX_TRACE,
                  spanId: HEX_SPAN_A,
                  name: 'a',
                  startTimeUnixNano: '1779955200000000000',
                  endTimeUnixNano: '1779955201000000000',
                },
                {
                  traceId: HEX_TRACE,
                  spanId: HEX_SPAN_B,
                  parentSpanId: HEX_SPAN_A,
                  name: 'b',
                  startTimeUnixNano: '1779955200500000000',
                  endTimeUnixNano: '1779955200800000000',
                },
              ],
            },
          ],
        },
      ],
    })
    const result = parseOtlpRequest(req)
    expect(result).toHaveLength(1)
    expect(result[0]?.steps).toHaveLength(2)
    expect(result[0]?.steps[1]?.parentSpanId).toBe(HEX_SPAN_A)
  })
})
