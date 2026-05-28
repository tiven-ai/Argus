import { User } from 'lucide-react'
import type { StepRenderer } from './types'
import { findEvent } from '../lib/step-helpers'

function MessageBubble({ text }: { text: string }) {
  return (
    <div className="flex gap-3 items-start">
      <div className="rounded-full bg-blue-100 p-2 shrink-0">
        <User className="h-4 w-4 text-blue-700" />
      </div>
      <div className="rounded-lg bg-blue-50 border border-blue-100 px-4 py-3 max-w-prose whitespace-pre-wrap text-sm">
        {text}
      </div>
    </div>
  )
}

export const UserMessageRenderer: StepRenderer = {
  id: 'user-message',
  match: (step) => (step.kind === 'user_message' ? 10 : 0),
  renderInput: (step) => {
    const input = findEvent(step, 'argus.input')
    const text = typeof input?.attributes.text === 'string' ? input.attributes.text : '(no text)'
    return <MessageBubble text={text} />
  },
  renderOutput: () => <p className="text-neutral-500 text-sm">(user messages have no output)</p>,
}
