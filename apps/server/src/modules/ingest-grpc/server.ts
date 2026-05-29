import * as grpc from '@grpc/grpc-js'
import { loadOtlpProto } from './proto-loader.js'
import { makeTraceServiceHandlers, type TraceServiceDeps } from './service.js'

export interface CreateGrpcServerOptions extends TraceServiceDeps {
  host: string
  port: number
}

export interface StartedGrpcServer {
  server: grpc.Server
  /** Actual port bound — useful when port=0 (random). */
  port: number
  /** Convenience for tests/teardown. */
  close(): Promise<void>
}

export async function startGrpcServer(opts: CreateGrpcServerOptions): Promise<StartedGrpcServer> {
  const { traceServiceDefinition } = loadOtlpProto()
  const server = new grpc.Server()
  const handlers = makeTraceServiceHandlers(opts)
  server.addService(traceServiceDefinition, handlers as Parameters<typeof server.addService>[1])

  const port = await new Promise<number>((resolve, reject) => {
    server.bindAsync(
      `${opts.host}:${opts.port}`,
      grpc.ServerCredentials.createInsecure(),
      (err, boundPort) => {
        if (err) reject(err)
        else resolve(boundPort)
      },
    )
  })

  return {
    server,
    port,
    close: () =>
      new Promise<void>((resolve) => {
        server.tryShutdown(() => resolve())
      }),
  }
}
