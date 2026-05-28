import { z } from 'zod'

const anyValueSchema = z.object({}).passthrough()
const keyValueSchema = z.object({ key: z.string(), value: anyValueSchema })

const eventSchema = z.object({
  timeUnixNano: z.string(),
  name: z.string(),
  attributes: z.array(keyValueSchema).optional().default([]),
})

const spanSchema = z.object({
  traceId: z.string(),
  spanId: z.string(),
  parentSpanId: z.string().optional(),
  name: z.string(),
  kind: z.number().int().optional(),
  startTimeUnixNano: z.string(),
  endTimeUnixNano: z.string(),
  attributes: z.array(keyValueSchema).optional().default([]),
  events: z.array(eventSchema).optional().default([]),
  status: z
    .object({
      code: z.number().int().optional(),
      message: z.string().optional(),
    })
    .optional(),
})

const scopeSpansSchema = z.object({
  scope: z.object({}).passthrough().optional(),
  spans: z.array(spanSchema),
})

const resourceSpansSchema = z.object({
  resource: z
    .object({
      attributes: z.array(keyValueSchema).optional().default([]),
    })
    .optional(),
  scopeSpans: z.array(scopeSpansSchema),
})

export const otlpExportRequestSchema = z.object({
  resourceSpans: z.array(resourceSpansSchema),
})

export type OtlpExportRequest = z.infer<typeof otlpExportRequestSchema>

export function decodeAttributeValue(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return undefined
  const v = value as Record<string, unknown>
  if ('stringValue' in v) return v.stringValue
  if ('boolValue' in v) return v.boolValue
  if ('intValue' in v) {
    const s = String(v.intValue)
    const n = Number(s)
    return Number.isSafeInteger(n) ? n : s
  }
  if ('doubleValue' in v) return v.doubleValue
  if ('arrayValue' in v) {
    const arr = (v.arrayValue as { values?: unknown[] }).values ?? []
    return arr.map(decodeAttributeValue)
  }
  if ('kvlistValue' in v) {
    const kvs = (v.kvlistValue as { values?: Array<{ key: string; value: unknown }> }).values ?? []
    const out: Record<string, unknown> = {}
    for (const kv of kvs) out[kv.key] = decodeAttributeValue(kv.value)
    return out
  }
  if ('bytesValue' in v) return v.bytesValue
  return undefined
}

export function attributesToObject(
  attrs: Array<{ key: string; value: unknown }>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const a of attrs) out[a.key] = decodeAttributeValue(a.value)
  return out
}
