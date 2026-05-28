/**
 * SSE framing helpers. JSON encoding escapes embedded newlines automatically,
 * so the resulting `data:` line is always a single physical line.
 */

export function formatSseEvent(id: string | undefined, payload: unknown): string {
  const data = `data: ${JSON.stringify(payload)}\n\n`
  return id !== undefined ? `id: ${id}\n${data}` : data
}

export function formatSseComment(comment: string): string {
  return `: ${comment}\n\n`
}
