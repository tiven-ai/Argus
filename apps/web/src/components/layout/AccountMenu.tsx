import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ChevronsUpDown, Check } from 'lucide-react'
import i18n, { LOCALE_LABELS, SUPPORTED_LOCALES, type SupportedLocale } from '@/i18n'
import { useAuth } from '@/lib/auth-provider'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'

export function AccountMenu() {
  const { t, i18n: i18nInstance } = useTranslation()
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const current = i18nInstance.resolvedLanguage as SupportedLocale | undefined

  async function handleLogout() {
    await logout()
    void navigate({ to: '/login' })
  }

  if (!user) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded px-2 py-1.5 u-body text-text-2 hover:bg-tile">
        <span className="truncate">{user.email}</span>
        <ChevronsUpDown className="ml-auto size-3.5 text-text-3" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" side="top">
        <DropdownMenuLabel>{t('shell.language')}</DropdownMenuLabel>
        {SUPPORTED_LOCALES.map((code) => (
          <DropdownMenuItem
            key={code}
            onSelect={(e) => {
              e.preventDefault()
              void i18n.changeLanguage(code)
            }}
          >
            <span>{LOCALE_LABELS[code]}</span>
            {current === code && <Check className="size-3.5 text-brand" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={handleLogout}>{t('shell.auth.signOut')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
