import { useNavigate, useSearch } from '@tanstack/react-router'

const PROJECT_KEY = 'argus.projectId'

function readStored(): string | null {
  return typeof localStorage !== 'undefined' ? localStorage.getItem(PROJECT_KEY) : null
}

/**
 * The active project filter, keyed on project id (not name) so a project
 * rename never orphans the selection. Read from the `?projectId=` search param,
 * falling back to localStorage. `setProject` takes a project id or null.
 */
export function useProjectFilter() {
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as { projectId?: string }
  const project = search.projectId ?? readStored() ?? null

  function setProject(next: string | null) {
    if (next) localStorage.setItem(PROJECT_KEY, next)
    else localStorage.removeItem(PROJECT_KEY)
    void navigate({ to: '/sessions', search: next ? { projectId: next } : {} })
  }

  return { project, setProject }
}
