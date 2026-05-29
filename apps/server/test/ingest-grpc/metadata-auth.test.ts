import { describe, expect, it } from 'vitest'
import * as grpc from '@grpc/grpc-js'
import { extractBearerToken } from '../../src/modules/ingest-grpc/metadata-auth.js'

describe('extractBearerToken', () => {
  it('returns the token from an "authorization: Bearer <token>" metadata entry', () => {
    const md = new grpc.Metadata()
    md.add('authorization', 'Bearer argus_abc123')
    expect(extractBearerToken(md)).toBe('argus_abc123')
  })

  it('is case-insensitive on the Bearer keyword', () => {
    const md = new grpc.Metadata()
    md.add('authorization', 'bearer argus_lower')
    expect(extractBearerToken(md)).toBe('argus_lower')
  })

  it('reads from "authorization" first, then falls back to "x-argus-token"', () => {
    const md = new grpc.Metadata()
    md.add('x-argus-token', 'argus_fromcustom')
    expect(extractBearerToken(md)).toBe('argus_fromcustom')

    const md2 = new grpc.Metadata()
    md2.add('authorization', 'Bearer argus_fromauth')
    md2.add('x-argus-token', 'argus_fromcustom')
    expect(extractBearerToken(md2)).toBe('argus_fromauth')
  })

  it('returns null when no token is present', () => {
    expect(extractBearerToken(new grpc.Metadata())).toBeNull()
  })

  it('returns null for an authorization header that is not Bearer', () => {
    const md = new grpc.Metadata()
    md.add('authorization', 'Basic dXNlcjpwYXNz')
    expect(extractBearerToken(md)).toBeNull()
  })
})
