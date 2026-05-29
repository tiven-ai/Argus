import { z } from 'zod'

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().url(),
  /**
   * Runtime pool (argus_app role). Optional in env; if absent, loadEnv
   * derives it from DATABASE_URL by swapping the credentials onto the
   * argus_app dev role. The migration runner keeps using DATABASE_URL
   * (super-user).
   */
  APP_DATABASE_URL: z.string().url().optional(),
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
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('Argus <noreply@argus.dev>'),
  APP_BASE_URL: z.string().url().default('http://localhost:5173'),
})

export type Env = z.infer<typeof envSchema>

export function loadEnv(env: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.parse(env)
  if (!parsed.APP_DATABASE_URL) {
    const u = new URL(parsed.DATABASE_URL)
    u.username = 'argus_app'
    u.password = process.env.ARGUS_APP_DB_PASSWORD ?? 'argus_app_dev_pwd'
    parsed.APP_DATABASE_URL = u.toString()
  }
  return parsed
}
