import { z } from 'zod'

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().url(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  // ARGUS_MODE: parsed but not yet enforced — multi-tenant gating lands in M4.
  ARGUS_MODE: z.enum(['local', 'multi-tenant']).default('local'),
})

export type Env = z.infer<typeof envSchema>

export function loadEnv(env: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(env)
}
