import type { Round } from '../../types/round'

interface Props {
  round: Round
}

export function RawSection({ round }: Props) {
  const payload = {
    id: round.id,
    trigger: round.trigger,
    llmCall: round.llmCall,
    toolExecutions: round.toolExecutions,
  }
  return (
    <pre className="u-caption bg-tile border border-hairline p-3 rounded overflow-auto text-text-2">
      {JSON.stringify(payload, null, 2)}
    </pre>
  )
}
