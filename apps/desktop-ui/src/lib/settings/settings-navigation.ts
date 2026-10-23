import { profileIcon } from '../ai-profiles/profile-icons'
import type { NavigationItem } from '../ui/navigation-item'

/** Settings pages without a parameter, in navigation order */
export const SETTINGS_PRIMARY_SECTIONS = [
  { id: 'general', labelKey: 'settings.generalTab', icon: 'mdi:tune-variant' },
  { id: 'editor', labelKey: 'settings.editorTab', icon: 'mdi:pencil-outline' },
  { id: 'history', labelKey: 'settings.historyTab', icon: 'mdi:history' },
  {
    id: 'global-actions',
    labelKey: 'settings.hotkeysTab',
    icon: 'mdi:keyboard-outline',
  },
  { id: 'stt', labelKey: 'settings.sttTab', icon: 'mdi:microphone-outline' },
  { id: 'llm', labelKey: 'settings.llmTab', icon: 'mdi:cube-outline' },
  {
    id: 'translations',
    labelKey: 'settings.translationsTab',
    icon: 'mdi:translate',
  },
  {
    id: 'accessibility',
    labelKey: 'settings.sectionAccessibility',
    icon: 'mdi:human-handsup',
  },
  {
    id: 'plugins',
    labelKey: 'settings.pluginsTab',
    icon: 'mdi:puzzle-outline',
  },
  {
    id: 'ai-profiles',
    labelKey: 'settings.aiProfilesTab',
    icon: 'mdi:account-group-outline',
  },
] as const

export const SETTINGS_ACTION_SECTIONS = [
  {
    id: 'main-actions',
    labelKey: 'settings.mainActionsTab',
    icon: 'mdi:gesture-tap-button',
  },
  { id: 'tasks', labelKey: 'settings.tasksTab', icon: 'mdi:robot-outline' },
  { id: 'languages', labelKey: 'settings.languagesTab', icon: 'mdi:web' },
  {
    id: 'launcher-commands',
    labelKey: 'settings.launcherCommandsTab',
    icon: 'mdi:console',
  },
  {
    id: 'commands',
    labelKey: 'settings.commandsTab',
    icon: 'mdi:console-line',
  },
] as const

export type SettingsSectionId =
  | (typeof SETTINGS_PRIMARY_SECTIONS)[number]['id']
  | (typeof SETTINGS_ACTION_SECTIONS)[number]['id']

/** A section shown by its own tab; the AI profiles section opens the overview */
export type SettingsPageSectionId = Exclude<SettingsSectionId, 'ai-profiles'>

export const DEFAULT_SETTINGS_TAB: SettingsPageSectionId = 'general'
export const AI_OVERVIEW_TAB = 'ai-profiles:overview'
/** The id part of a profile or project tab that creates a new one */
export const NEW_ENTITY_ID = 'new'

const SECTIONS = [...SETTINGS_PRIMARY_SECTIONS, ...SETTINGS_ACTION_SECTIONS]
const SECTION_IDS = new Set<string>(SECTIONS.map((section) => section.id))

/** What a settings tab id names; detail pages carry their entity id */
export type SettingsTab =
  | { kind: 'section'; id: SettingsPageSectionId }
  | { kind: 'ai-overview' }
  | { kind: 'plugin'; pluginId: string }
  | { kind: 'ai-profile'; profileId: string }
  | { kind: 'ai-project'; projectId: string }
  | { kind: 'unknown' }

const PREFIXES = {
  'plugin:': 'plugin',
  'ai-profile:': 'ai-profile',
  'ai-project:': 'ai-project',
} as const

export function parseSettingsTab(tab: string): SettingsTab {
  // the bare AI profiles section opens the overview
  if (tab === 'ai-profiles' || tab === AI_OVERVIEW_TAB)
    return { kind: 'ai-overview' }
  if (SECTION_IDS.has(tab))
    return { kind: 'section', id: tab as SettingsPageSectionId }
  for (const [prefix, kind] of Object.entries(PREFIXES)) {
    if (!tab.startsWith(prefix)) continue
    const id = tab.slice(prefix.length)
    if (!id) break
    if (kind === 'plugin') return { kind, pluginId: id }
    if (kind === 'ai-profile') return { kind, profileId: id }
    return { kind: 'ai-project', projectId: id }
  }
  return { kind: 'unknown' }
}

export const pluginTab = (pluginId: string) => `plugin:${pluginId}`
export const profileTab = (profileId: string) => `ai-profile:${profileId}`
export const projectTab = (projectId: string) => `ai-project:${projectId}`

export interface SettingsNavigationSources {
  translate: (key: string) => string
  profiles: readonly { id: string; name: string; icon?: string }[]
  projects: readonly { id: string; name: string; isExternal: boolean }[]
  plugins: readonly { pluginId: string; label: string; isEnabled: boolean }[]
}

const projectIcon = (isExternal: boolean) =>
  isExternal ? 'mdi:folder-open-outline' : 'mdi:folder-table-outline'

function aiNavigationItems(
  sources: SettingsNavigationSources
): NavigationItem[] {
  const { translate } = sources
  return [
    {
      id: AI_OVERVIEW_TAB,
      name: translate('settings.aiProfilesOverview'),
      icon: 'mdi:folder-outline',
      nested: true,
    },
    ...sources.profiles.map((profile) => ({
      id: profileTab(profile.id),
      name: profile.name,
      icon: profileIcon(profile),
      nested: true,
    })),
    {
      id: profileTab(NEW_ENTITY_ID),
      name: `+ ${translate('settings.newProfile')}`,
      icon: 'mdi:plus',
      nested: true,
    },
    ...sources.projects.map((project) => ({
      id: projectTab(project.id),
      name: project.name,
      icon: projectIcon(project.isExternal),
      nested: true,
    })),
    {
      id: projectTab(NEW_ENTITY_ID),
      name: `+ ${translate('settings.newProject')}`,
      icon: 'mdi:plus',
      nested: true,
    },
  ]
}

function pluginNavigationItems(
  sources: SettingsNavigationSources
): NavigationItem[] {
  return sources.plugins.map((plugin) => ({
    id: pluginTab(plugin.pluginId),
    name: plugin.label,
    icon: 'mdi:puzzle-outline',
    nested: true,
    status: sources.translate(
      plugin.isEnabled ? 'settings.pluginStatusOn' : 'settings.pluginStatusOff'
    ),
    isEnabled: plugin.isEnabled,
  }))
}

const isAiTab = (tab: SettingsTab) =>
  tab.kind === 'ai-overview' ||
  tab.kind === 'ai-profile' ||
  tab.kind === 'ai-project'

/**
 * The two navigation lists. Plugins are always listed; the profiles and
 * projects only while one of their pages is open
 */
export function buildSettingsNavigation(
  currentTab: string,
  sources: SettingsNavigationSources
) {
  const current = parseSettingsTab(currentTab)
  const sectionItem = (section: (typeof SECTIONS)[number]) => ({
    id: section.id,
    name: sources.translate(section.labelKey),
    icon: section.icon,
  })
  const primary = SETTINGS_PRIMARY_SECTIONS.flatMap((section) => {
    const item = sectionItem(section)
    if (section.id === 'plugins')
      return [item, ...pluginNavigationItems(sources)]
    if (section.id === 'ai-profiles' && isAiTab(current))
      return [item, ...aiNavigationItems(sources)]
    return [item]
  })
  return {
    primary: primary as NavigationItem[],
    actions: SETTINGS_ACTION_SECTIONS.map(sectionItem) as NavigationItem[],
  }
}

/**
 * Whether a tab can be shown. A profile or project tab is accepted while the
 * vault is still being read, since its entity may not be known yet
 */
export function isSettingsTabAvailable(
  tab: string,
  sources: Omit<SettingsNavigationSources, 'translate'> & {
    isVaultLoaded: boolean
  }
): boolean {
  const parsed = parseSettingsTab(tab)
  switch (parsed.kind) {
    case 'section':
    case 'ai-overview':
      return true
    case 'plugin':
      return sources.plugins.some(
        (plugin) => plugin.pluginId === parsed.pluginId
      )
    case 'ai-profile':
      return (
        !sources.isVaultLoaded ||
        parsed.profileId === NEW_ENTITY_ID ||
        sources.profiles.some((profile) => profile.id === parsed.profileId)
      )
    case 'ai-project':
      return (
        !sources.isVaultLoaded ||
        parsed.projectId === NEW_ENTITY_ID ||
        sources.projects.some((project) => project.id === parsed.projectId)
      )
    default:
      return false
  }
}

/** The page heading of a tab */
export function settingsTabTitle(
  tab: string,
  sources: SettingsNavigationSources
): string {
  const { translate } = sources
  const parsed = parseSettingsTab(tab)
  switch (parsed.kind) {
    case 'section':
      return translate(
        SECTIONS.find((section) => section.id === parsed.id)!.labelKey
      )
    case 'ai-overview':
      return translate('settings.aiProfilesTab')
    case 'plugin':
      return (
        sources.plugins.find((plugin) => plugin.pluginId === parsed.pluginId)
          ?.label ?? ''
      )
    case 'ai-profile':
      if (parsed.profileId === NEW_ENTITY_ID)
        return translate('settings.newProfile')
      return (
        sources.profiles.find((profile) => profile.id === parsed.profileId)
          ?.name || translate('settings.aiProfilesTab')
      )
    case 'ai-project':
      if (parsed.projectId === NEW_ENTITY_ID)
        return translate('settings.newProject')
      return (
        sources.projects.find((project) => project.id === parsed.projectId)
          ?.name || translate('settings.projectsTitle')
      )
    default:
      return ''
  }
}
