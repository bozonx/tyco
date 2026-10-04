import type {
  HotkeyApplyResult,
  HotkeyPlatform,
  HotkeyProviderInfo,
  HotkeyProviderKind,
} from '@tyco/shared'

export interface HotkeySettingsState {
  provider: HotkeyProviderKind | null
  canConfigure: boolean
  statuses: Record<string, HotkeyApplyResult>
  systemTriggers: Record<string, string>
  defaults: Record<string, string>
  platform: HotkeyPlatform
}

export function createHotkeySettingsState(): HotkeySettingsState {
  return {
    provider: null,
    canConfigure: false,
    statuses: {},
    systemTriggers: {},
    defaults: {},
    platform: 'linux',
  }
}

export function applyProviderInfo(
  state: HotkeySettingsState,
  info: HotkeyProviderInfo
): void {
  state.provider = info.provider
  state.canConfigure = info.canConfigure
  state.statuses = { ...info.actions }
  state.systemTriggers = { ...(info.systemTriggers ?? {}) }
  state.defaults = { ...(info.defaults ?? {}) }
  state.platform = info.platform ?? 'linux'
}

/**
 * Whether the user records the shortcuts here. Until the provider is known
 * nothing is recorded: the desktop may own them.
 */
export function isEditable(state: HotkeySettingsState): boolean {
  return state.provider !== null && state.provider !== 'portal'
}

/** The platform's default shortcut of a hotkey id, else the given fallback. */
export function defaultShortcut(
  state: HotkeySettingsState,
  id: string,
  fallback: string
): string {
  return state.defaults[id] ?? fallback
}

/**
 * Portal shortcuts belong to the desktop: Tyco only proposes them once, and the
 * user changes them in the desktop settings.
 */
export function isSystemManaged(state: HotkeySettingsState): boolean {
  return state.provider === 'portal'
}

/**
 * The shortcut to show for an action: the one the desktop bound, when it
 * manages them, otherwise the configured one.
 */
export function displayedShortcut(
  state: HotkeySettingsState,
  id: string,
  configured: string
): string {
  if (!isSystemManaged(state)) return configured
  // KDE lists alternative shortcuts separated by commas; the first is the
  // one to show
  return (state.systemTriggers[id] ?? '').split(', ')[0].trim()
}

/** The i18n key of the note that applies to every hotkey of the provider. */
export function providerNoteKey(state: HotkeySettingsState): string | null {
  switch (state.provider) {
    case 'portal':
      return 'settings.hotkeyProvider.portal'
    case 'external':
      return 'settings.hotkeyProvider.external'
    default:
      return null
  }
}

/**
 * The per-action status worth showing is a conflict: the field itself shows
 * that a change succeeded, and the provider note covers the rest.
 */
export function hasConflict(state: HotkeySettingsState, id: string): boolean {
  return state.statuses[id]?.status === 'conflict'
}
