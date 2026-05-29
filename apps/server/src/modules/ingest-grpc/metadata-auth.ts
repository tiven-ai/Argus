import type * as grpc from '@grpc/grpc-js'

/**
 * Extract a bearer token from gRPC call metadata.
 *
 * Priority:
 *   1. `authorization: Bearer <token>`  (the OTLP/gRPC standard)
 *   2. `x-argus-token: <token>`         (Argus-specific fallback for clients
 *                                        that can't set Authorization in metadata,
 *                                        e.g. some browser-side gRPC-Web setups)
 *
 * Returns null when no usable token is present.
 */
export function extractBearerToken(metadata: grpc.Metadata): string | null {
  const authValues = metadata.get('authorization')
  for (const raw of authValues) {
    const value = String(raw).trim()
    const m = /^Bearer\s+(.+)$/i.exec(value)
    if (m && m[1]) return m[1].trim()
  }

  const customValues = metadata.get('x-argus-token')
  for (const raw of customValues) {
    const value = String(raw).trim()
    if (value.length > 0) return value
  }

  return null
}
