import {
  Activity,
  BarChart3,
  FlaskConical,
  FolderOpen,
  KeyRound,
  ListTree,
  Plug,
  Settings,
  Users,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export interface NavEntry {
  key: string
  /** i18n key for the label */
  labelKey: string
  icon: LucideIcon
  /** route path; undefined when soon */
  to?: string
  soon?: boolean
}

export const MODULE_NAV: NavEntry[] = [
  { key: 'sessions', labelKey: 'shell.modules.sessions', icon: ListTree, to: '/sessions' },
  { key: 'monitoring', labelKey: 'shell.modules.monitoring', icon: Activity, soon: true },
  { key: 'analytics', labelKey: 'shell.modules.analytics', icon: BarChart3, soon: true },
  { key: 'evals', labelKey: 'shell.modules.evals', icon: FlaskConical, soon: true },
]

export const SETTINGS_NAV: NavEntry[] = [
  { key: 'tokens', labelKey: 'shell.settingsNav.tokens', icon: KeyRound, to: '/settings/tokens' },
  {
    key: 'projects',
    labelKey: 'shell.settingsNav.projects',
    icon: FolderOpen,
    to: '/settings/projects',
  },
  { key: 'members', labelKey: 'shell.settingsNav.members', icon: Users, soon: true },
  { key: 'general', labelKey: 'shell.settingsNav.general', icon: Settings, soon: true },
  { key: 'integrations', labelKey: 'shell.settingsNav.integrations', icon: Plug, soon: true },
]
