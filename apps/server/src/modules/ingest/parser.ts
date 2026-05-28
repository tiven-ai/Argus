import type { NewStep, WriteTraceInput } from '../storage/types.js'
import { attributesToObject, type OtlpExportRequest } from './otlp-json.js'
import { DEFAULT_ORG_ID } from '../../constants.js'

export { DEFAULT_ORG_ID } from '../../constants.js'

export class OtlpParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OtlpParseError'
  }
}

export function parseOtlpRequest(req: OtlpExportRequest): WriteTraceInput[] {
  const traces = new Map<string, WriteTraceInput>()

  for (const rs of req.resourceSpans) {
    const resourceAttrs = attributesToObject(rs.resource?.attributes ?? [])
    const projectName = resourceAttrs['argus.project']
    const serviceName = resourceAttrs['argus.service'] ?? resourceAttrs['service.name']

    if (typeof projectName !== 'string' || !projectName) {
      throw new OtlpParseError('Resource attribute "argus.project" is required')
    }
    if (typeof serviceName !== 'string' || !serviceName) {
      throw new OtlpParseError(
        'Resource attribute "argus.service" (or fallback "service.name") is required',
      )
    }

    for (const ss of rs.scopeSpans) {
      for (const span of ss.spans) {
        const attrs = attributesToObject(span.attributes ?? [])
        const startedAt = unixNanoToDate(span.startTimeUnixNano)
        const endedAt = unixNanoToDate(span.endTimeUnixNano)
        const traceId = normalizeId(span.traceId, 32)
        const spanId = normalizeId(span.spanId, 16)
        const parentSpanId = span.parentSpanId ? normalizeId(span.parentSpanId, 16) : null

        const step: NewStep = {
          spanId,
          parentSpanId,
          name: span.name,
          kind: (attrs['argus.step.kind'] as string | undefined) ?? null,
          componentType: (attrs['argus.component.type'] as string | undefined) ?? null,
          componentName: (attrs['argus.component.name'] as string | undefined) ?? null,
          startedAt,
          endedAt,
          attributes: attrs,
          statusCode: statusCodeName(span.status?.code),
          statusMessage: span.status?.message ?? null,
          events: (span.events ?? []).map((e) => ({
            name: e.name,
            ts: unixNanoToDate(e.timeUnixNano),
            attributes: attributesToObject(e.attributes ?? []),
          })),
        }

        const key = `${serviceName}|${traceId}`
        let trace = traces.get(key)
        if (!trace) {
          trace = {
            orgId: DEFAULT_ORG_ID,
            projectName,
            serviceName,
            traceId,
            sessionStartedAt: startedAt,
            sessionEndedAt: endedAt,
            steps: [],
          }
          traces.set(key, trace)
        } else {
          if (startedAt < trace.sessionStartedAt) trace.sessionStartedAt = startedAt
          if (!trace.sessionEndedAt || endedAt > trace.sessionEndedAt) {
            trace.sessionEndedAt = endedAt
          }
        }
        trace.steps.push(step)
      }
    }
  }

  return Array.from(traces.values())
}

function unixNanoToDate(s: string): Date {
  const ns = BigInt(s)
  const ms = Number(ns / 1_000_000n)
  return new Date(ms)
}

function statusCodeName(code: number | undefined): 'UNSET' | 'OK' | 'ERROR' {
  switch (code) {
    case 1:
      return 'OK'
    case 2:
      return 'ERROR'
    default:
      return 'UNSET'
  }
}

function normalizeId(id: string, hexLength: number): string {
  if (id.length === hexLength && /^[0-9a-f]+$/i.test(id)) {
    return id.toLowerCase()
  }
  try {
    const buf = Buffer.from(id, 'base64')
    return buf.toString('hex')
  } catch {
    throw new OtlpParseError(`Invalid trace/span id: ${id}`)
  }
}
