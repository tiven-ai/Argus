import type { Step } from '@argus/shared-types'
import type { Round } from '../types/round'

function isLlmCall(step: Step): boolean {
  return step.kind === 'llm_call' || step.componentType === 'llm'
}

function isTriggerCandidate(step: Step): boolean {
  return step.kind === 'user_message' || step.kind === 'tool_call'
}

export function computeRounds(steps: Step[]): Round[] {
  const sorted = [...steps].sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  const llmCalls = sorted.filter(isLlmCall)
  if (llmCalls.length === 0) return []

  const llmIndices = new Set(llmCalls.map((c) => c.id))

  return llmCalls.map((llm, i) => {
    // Trigger: most recent trigger-candidate strictly before this LLM call's start.
    let trigger: Step | undefined
    for (const s of sorted) {
      if (s.id === llm.id) break
      if (s.startedAt >= llm.startedAt) break
      if (isTriggerCandidate(s)) trigger = s
    }

    // Tool executions: tool_calls that started at or after this LLM call's end
    // and strictly before the next LLM call's start. (We use `>=` here so a tool
    // that fires the same instant the LLM ends still counts.)
    const nextStart =
      i + 1 < llmCalls.length ? llmCalls[i + 1]!.startedAt : '9999-12-31T23:59:59.999Z'
    const toolExecutions = sorted.filter(
      (s) =>
        s.kind === 'tool_call' &&
        s.startedAt >= llm.endedAt &&
        s.startedAt < nextStart &&
        !llmIndices.has(s.id),
    )

    return {
      id: llm.id,
      llmCall: llm,
      trigger,
      toolExecutions,
    }
  })
}
