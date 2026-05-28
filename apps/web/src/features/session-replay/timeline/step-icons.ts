import { Bot, Brain, Circle, Globe, Settings, User, Wrench, type LucideIcon } from 'lucide-react'
import type { Step } from '@argus/shared-types'

export function iconForStep(step: Step): LucideIcon {
  switch (step.kind) {
    case 'user_message':
      return User
    case 'assistant_message':
      return Bot
    case 'system_prompt':
      return Settings
    case 'llm_call':
      return Brain
    case 'tool_call':
      return Wrench
    case 'external_resource':
      return Globe
    default:
      return Circle
  }
}
