import type { NavigationItem } from '../ui/navigation-item'

/**
 * Settings pages without a parameter, grouped and in navigation order. The
 * first group sits under the settings title and has no heading of its own
 */
export const SETTINGS_NAVIGATION_GROUPS = [
  {
    id: 'general',
    sections: [
      {
        id: 'general',
        labelKey: 'settings.generalTab',
        icon: 'mdi:tune-variant',
      },
      {
        id: 'editor',
        labelKey: 'settings.editorTab',
        icon: 'mdi:pencil-outline',
      },
      { id: 'history', labelKey: 'settings.historyTab', icon: 'mdi:history' },
      {
        id: 'global-actions',
        labelKey: 'settings.hotkeysTab',
        icon: 'mdi:keyboard-outline',
      },
      {
        id: 'accessibility',
        labelKey: 'settings.sectionAccessibility',
        icon: 'mdi:human-handsup',
      },
    ],
  },
  {
    id: 'models',
    labelKey: 'settings.modelsCategory',
    sections: [
      {
        id: 'stt',
        labelKey: 'settings.sttTab',
        icon: 'mdi:microphone-outline',
      },
      { id: 'llm', labelKey: 'settings.llmTab', icon: 'mdi:cube-outline' },
      {
        id: 'translations',
        labelKey: 'settings.translationsTab',
        icon: 'mdi:translate',
      },
      {
        id: 'ai-profiles',
        labelKey: 'settings.aiProfilesTab',
        icon: 'mdi:account-group-outline',
      },
    ],
  },
  {
    id: 'actions',
    labelKey: 'settings.actionsCategory',
    sections: [
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
    ],
  },
  {
    id: 'plugins',
    labelKey: 'settings.pluginsTab',
    sections: [
      {
        id: 'plugins',
        labelKey: 'settings.pluginsTab',
        navigationLabelKey: 'settings.allPluginsTab',
        icon: 'mdi:view-grid-outline',
      },
    ],
  },
] as const

type SettingsSection =
  (typeof SETTINGS_NAVIGATION_GROUPS)[number]['sections'][number]

export type SettingsSectionId = SettingsSection['id']

/** A section shown by its own tab; the AI profiles section opens the overview */
export type SettingsPageSectionId = Exclude<SettingsSectionId, 'ai-profiles'>

export const DEFAULT_SETTINGS_TAB: SettingsPageSectionId = 'general'
export const AI_OVERVIEW_TAB = 'ai-profiles:overview'
/** The id part of a profile or project tab that creates a new one */
export const NEW_ENTITY_ID = 'new'

const SECTIONS = SETTINGS_NAVIGATION_GROUPS.flatMap(
  (group): readonly SettingsSection[] => group.sections
)
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
  isInDevelopment?: boolean
  translate: (key: string) => string
  profiles: readonly { id: string; name: string; icon?: string }[]
  projects: readonly { id: string; name: string; isExternal: boolean }[]
  plugins: readonly { pluginId: string; label: string; isEnabled: boolean }[]
}

/**
 * The navigation item a tab marks: a plugin page has its own item, a profile or
 * project page marks the AI profiles section
 */
export function settingsNavigationItemId(tab: string): string | undefined {
  const parsed = parseSettingsTab(tab)
  switch (parsed.kind) {
    case 'section':
      return parsed.id
    case 'ai-overview':
    case 'ai-profile':
    case 'ai-project':
      return 'ai-profiles'
    case 'plugin':
      return pluginTab(parsed.pluginId)
    default:
      return undefined
  }
}

export interface SettingsNavigationGroup {
  id: string
  label?: string
  items: NavigationItem[]
}

/**
 * The navigation groups. Each plugin follows the page listing all plugins;
 * profiles and projects are listed only on their own page
 */
export function buildSettingsNavigation(
  sources: Pick<
    SettingsNavigationSources,
    'translate' | 'plugins' | 'isInDevelopment'
  >
): SettingsNavigationGroup[] {
  const { translate } = sources
  return SETTINGS_NAVIGATION_GROUPS.map((group) => {
    const items: NavigationItem[] = group.sections
      .filter(
        (section) =>
          !['ai-profiles', 'commands', 'launcher-commands'].includes(
            section.id
          ) || sources.isInDevelopment
      )
      .map((section) => ({
        id: section.id,
        name: translate(navigationLabelKey(section)),
        icon: section.icon,
      }))
    if (group.id === 'plugins')
      items.push(...sources.plugins.map(pluginNavigationItem(translate)))
    return {
      id: group.id,
      label: 'labelKey' in group ? translate(group.labelKey) : undefined,
      items,
    }
  })
}

/** A section may name itself in the navigation unlike its page heading */
const navigationLabelKey = (section: {
  labelKey: string
  navigationLabelKey?: string
}) => section.navigationLabelKey ?? section.labelKey

/** Only a disabled plugin carries a status, as the exception to note */
const pluginNavigationItem =
  (translate: (key: string) => string) =>
  (plugin: SettingsNavigationSources['plugins'][number]): NavigationItem => ({
    id: pluginTab(plugin.pluginId),
    name: plugin.label,
    icon: 'mdi:puzzle-outline',
    ...(plugin.isEnabled
      ? {}
      : { status: translate('settings.pluginStatusOff'), isEnabled: false }),
  })

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
  if (
    ['ai-overview', 'ai-profile', 'ai-project'].includes(parsed.kind) &&
    !sources.isInDevelopment
  )
    return false
  switch (parsed.kind) {
    case 'section':
      return (
        !['commands', 'launcher-commands'].includes(parsed.id) ||
        Boolean(sources.isInDevelopment)
      )
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
