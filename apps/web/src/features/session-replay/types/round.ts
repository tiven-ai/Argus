import type { Step } from '@argus/shared-types'

/**
 * A logical "round" of agent interaction, anchored by one LLM call.
 * - `llmCall` is the anchoring span.
 * - `trigger` is the span that kicked off this round (user_message or a tool_call
 *   from the previous round). Undefined for the very first round if no preceding
 *   user_message exists.
 * - `toolExecutions` are tool_call spans that ran after this LLM call's
 *   `tool_calls` output and before the next round's LLM call. They effectively
 *   become the trigger of the next round.
 */
export interface Round {
  id: string // = llmCall.id
  llmCall: Step
  trigger: Step | undefined
  toolExecutions: Step[]
}
