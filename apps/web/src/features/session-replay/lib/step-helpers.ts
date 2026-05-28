import type { Step, StepEvent } from '@argus/shared-types'

export function findEvent(step: Step, name: string): StepEvent | undefined {
  return step.events.find((e) => e.name === name)
}

export function durationMs(step: Step): number {
  return new Date(step.endedAt).getTime() - new Date(step.startedAt).getTime()
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.floor((ms % 60_000) / 1000)
  return `${minutes}m ${seconds}s`
}

export function tokenUsage(step: Step): { input: number; output: number } | null {
  const attrs = step.attributes
  const input = attrs['gen_ai.usage.input_tokens']
  const output = attrs['gen_ai.usage.output_tokens']
  if (typeof input !== 'number' && typeof output !== 'number') return null
  return {
    input: typeof input === 'number' ? input : 0,
    output: typeof output === 'number' ? output : 0,
  }
}

export function sessionTokens(steps: Step[]): { input: number; output: number } {
  let input = 0
  let output = 0
  for (const step of steps) {
    const t = tokenUsage(step)
    if (t) {
      input += t.input
      output += t.output
    }
  }
  return { input, output }
}

export function sessionDurationMs(steps: Step[]): number {
  if (steps.length === 0) return 0
  let start = Infinity
  let end = -Infinity
  for (const s of steps) {
    const sMs = new Date(s.startedAt).getTime()
    const eMs = new Date(s.endedAt).getTime()
    if (sMs < start) start = sMs
    if (eMs > end) end = eMs
  }
  return end - start
}

export function sessionStatus(steps: Step[]): 'OK' | 'ERROR' | 'UNSET' {
  if (steps.some((s) => s.statusCode === 'ERROR')) return 'ERROR'
  if (steps.every((s) => s.statusCode === 'OK')) return 'OK'
  return 'UNSET'
}
