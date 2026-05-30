import {
  GetSessionResponseSchema,
  ListSessionsResponseSchema,
  ListProjectsResponseSchema,
  type GetSessionResponse,
  type ListSessionsResponse,
  type ListProjectsResponse,
} from '@argus/shared-types'

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, { credentials: 'same-origin', ...init })
  if (res.status === 401) throw new Error('UNAUTHENTICATED')
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`)
  return res.json()
}

export async function fetchSessions(projectId?: string): Promise<ListSessionsResponse> {
  const qs = projectId ? `?projectId=${encodeURIComponent(projectId)}` : ''
  return ListSessionsResponseSchema.parse(await fetchJson(`/api/sessions${qs}`))
}

export async function fetchProjects(): Promise<ListProjectsResponse> {
  return ListProjectsResponseSchema.parse(await fetchJson('/api/projects'))
}

export async function fetchSession(id: string): Promise<GetSessionResponse> {
  return GetSessionResponseSchema.parse(await fetchJson(`/api/sessions/${id}`))
}

// ---------- auth ----------

export interface AuthUser {
  id: string
  email: string
  orgId: string
  emailVerifiedAt: string | null
}

export async function fetchMe(): Promise<AuthUser | null> {
  try {
    const data = (await fetchJson('/auth/me')) as { user: AuthUser }
    return data.user
  } catch (err) {
    if ((err as Error).message === 'UNAUTHENTICATED') return null
    throw err
  }
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const data = (await fetchJson('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })) as { user: AuthUser }
  return data.user
}

export async function register(email: string, password: string): Promise<AuthUser> {
  const data = (await fetchJson('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })) as { user: AuthUser }
  return data.user
}

export async function logout(): Promise<void> {
  await fetchJson('/auth/logout', { method: 'POST' })
}

// ---------- tokens ----------

export interface TokenRecord {
  id: string
  projectId: string
  projectName: string
  name: string
  prefix: string
  createdAt: string
  revokedAt: string | null
}

export async function listTokens(): Promise<TokenRecord[]> {
  const data = (await fetchJson('/api/tokens')) as { tokens: TokenRecord[] }
  return data.tokens
}

export interface CreatedToken {
  token: string
  record: {
    id: string
    projectId: string
    name: string
    prefix: string
    createdAt: string
  }
}

export async function createToken(input: {
  projectName: string
  tokenName: string
}): Promise<CreatedToken> {
  return (await fetchJson('/api/tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })) as CreatedToken
}

export async function revokeToken(id: string): Promise<void> {
  await fetchJson(`/api/tokens/${id}`, { method: 'DELETE' })
}
