import {
  GetSessionResponseSchema,
  ListSessionsResponseSchema,
  type GetSessionResponse,
  type ListSessionsResponse,
} from '@argus/shared-types'

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`)
  return res.json()
}

export async function fetchSessions(): Promise<ListSessionsResponse> {
  return ListSessionsResponseSchema.parse(await fetchJson('/api/sessions'))
}

export async function fetchSession(id: string): Promise<GetSessionResponse> {
  return GetSessionResponseSchema.parse(await fetchJson(`/api/sessions/${id}`))
}
