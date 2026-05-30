import { ChevronsUpDown, Check } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { fetchProjects } from '@/lib/api'
import { useProjectFilter } from '@/lib/use-project-filter'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'

export function ProjectSwitcher() {
  const { t } = useTranslation()
  const { project, setProject } = useProjectFilter()
  const { data } = useQuery({ queryKey: ['projects'], queryFn: fetchProjects, retry: false })
  const projects = data ? data.projects.map((p) => p.name) : []
  const current = project ?? t('shell.project.all')

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded border border-hairline px-2 py-1.5 u-body text-text-1 hover:bg-tile">
        <span className="truncate">{current}</span>
        <ChevronsUpDown className="ml-auto size-3.5 text-text-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]">
        <DropdownMenuItem onSelect={() => setProject(null)}>
          <span>{t('shell.project.all')}</span>
          {project === null && <Check className="size-3.5 text-brand" />}
        </DropdownMenuItem>
        {projects.length > 0 && <DropdownMenuSeparator />}
        {projects.map((p) => (
          <DropdownMenuItem key={p} onSelect={() => setProject(p)}>
            <span className="truncate" title={p}>
              {p}
            </span>
            {project === p && <Check className="size-3.5 text-brand" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
