import type { Round } from '../../types/round'

interface Props {
  round: Round
}

export function RawSection({ round }: Props) {
  // Combine the round into a single readable JSON dump.
  const payload = {
    id: round.id,
    trigger: round.trigger,
    llmCall: round.llmCall,
    toolExecutions: round.toolExecutions,
  }
  return (
    <pre className="text-xs bg-neutral-50 border p-3 rounded overflow-auto">
      {JSON.stringify(payload, null, 2)}
    </pre>
  )
}
