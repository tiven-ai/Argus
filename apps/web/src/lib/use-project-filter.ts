import { useNavigate, useSearch } from '@tanstack/react-router'

const PROJECT_KEY = 'argus.project'

function readStored(): string | null {
  return typeof localStorage !== 'undefined' ? localStorage.getItem(PROJECT_KEY) : null
}

export function useProjectFilter() {
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as { project?: string }
  const project = search.project ?? readStored() ?? null

  function setProject(next: string | null) {
    if (next) localStorage.setItem(PROJECT_KEY, next)
    else localStorage.removeItem(PROJECT_KEY)
    void navigate({ to: '/sessions', search: next ? { project: next } : {} })
  }

  return { project, setProject }
}
