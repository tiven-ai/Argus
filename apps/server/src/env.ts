import { z } from 'zod'

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().url(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  // ARGUS_MODE: parsed AND enforced as of M4 — `local` skips auth (auto-default-user);
  // `multi-tenant` requires real cookie/token auth on every request.
  ARGUS_MODE: z.enum(['local', 'multi-tenant']).default('local'),
  // JWT secret used to sign cookie sessions. Must be at least 32 chars in
  // multi-tenant mode; ignored content-wise in local mode but still required to
  // be defined so the schema stays uniform.
  JWT_SECRET: z.string().min(32).default('local-dev-secret-not-for-production-x'),
  COOKIE_NAME: z.string().default('argus_session'),
  // GRPC_PORT=0 disables the gRPC ingest server entirely. Default 4317 is the
  // OTLP standard.
  GRPC_PORT: z.coerce.number().int().min(0).default(4317),
})

export type Env = z.infer<typeof envSchema>

export function loadEnv(env: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(env)
}
