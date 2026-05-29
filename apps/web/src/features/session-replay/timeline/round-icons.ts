import { Bot, User, Wrench, type LucideIcon } from 'lucide-react'
import type { TFunction } from 'i18next'
import type { Round } from '../types/round'

export function iconForRoundTrigger(round: Round): LucideIcon {
  if (!round.trigger) return Bot
  if (round.trigger.kind === 'user_message') return User
  if (round.trigger.kind === 'tool_call') return Wrench
  return Bot
}

export function labelForRoundTrigger(round: Round, t: TFunction): string {
  if (!round.trigger) return t('timeline.trigger.initial')
  if (round.trigger.kind === 'user_message') return t('timeline.trigger.user')
  if (round.trigger.kind === 'tool_call') {
    const name = round.trigger.componentName ?? round.trigger.name
    return t('timeline.trigger.toolResult', { name })
  }
  return round.trigger.kind ?? round.trigger.name
}
