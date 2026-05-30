import { ChevronsUpDown, Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/lib/auth-provider'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'

export function OrgSwitcher() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const label = t('shell.org.workspace')

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex w-full items-center gap-2 rounded border border-hairline px-2 py-1.5 u-body text-text-1 hover:bg-tile"
        title={user?.orgId}
      >
        <span className="truncate">{label}</span>
        <ChevronsUpDown className="ml-auto size-3.5 text-text-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-[var(--radix-dropdown-menu-trigger-width)]">
        <DropdownMenuItem>
          <span>{label}</span>
          <Check className="size-3.5 text-brand" />
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>{t('shell.org.manageTeams')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
