import type {
  HotkeyApplyResult,
  HotkeyPlatform,
  HotkeyProviderInfo,
  HotkeyProviderKind,
} from '@tyco/shared'

import {
  keyLabelFor,
  shortcutAlternatives,
  shortcutKeys,
} from './hotkey-recorder'

export interface HotkeySettingsState {
  provider: HotkeyProviderKind | null
  canConfigure: boolean
  statuses: Record<string, HotkeyApplyResult>
  systemTriggers: Record<string, string>
  registered: boolean
  defaults: Record<string, string>
  platform: HotkeyPlatform
}

export function createHotkeySettingsState(): HotkeySettingsState {
  return {
    provider: null,
    canConfigure: false,
    statuses: {},
    systemTriggers: {},
    registered: false,
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
  state.registered = info.registered ?? false
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
  return state.systemTriggers[id] ?? ''
}

/**
 * The shortcut that opens `mode`, as one label next to the keys of a button:
 * its first alternative, with the keys named the way the platform does. Empty
 * until the provider is known, since the desktop may have bound another one.
 */
export function activationShortcutLabel(
  state: HotkeySettingsState,
  mode: string,
  configured: string
): string {
  if (state.provider === null) return ''
  const [shortcut] = shortcutAlternatives(
    displayedShortcut(state, mode, configured)
  )
  if (!shortcut) return ''
  return shortcutKeys(shortcut)
    .map((key) => keyLabelFor(key, state.platform))
    .join(state.platform === 'macos' ? '' : '+')
}

/**
 * The hotkeys the desktop no longer has: the user removed them in its settings.
 * One the user only cleared is still there, without a shortcut.
 */
export function missingHotkeys(
  state: HotkeySettingsState,
  ids: string[]
): string[] {
  if (!isSystemManaged(state) || !state.registered) return []
  return ids.filter((id) => !(id in state.systemTriggers))
}

/** The i18n key of the note that applies to every hotkey of the provider. */
export function providerNoteKey(state: HotkeySettingsState): string | null {
  switch (state.provider) {
    case 'portal':
      return state.canConfigure
        ? 'settings.hotkeyProvider.portal'
        : 'settings.hotkeyProvider.portalNoSettings'
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

/** CLI spellings of the modes whose ids are not already lowercase words */
const CLI_MODES: Record<string, string> = {
  voiceChat: 'voice-chat',
  voiceCommands: 'voice-commands',
  aiTasks: 'ai-tasks',
  commandLauncher: 'command-launcher',
  config: 'settings',
}

/** The shell line that opens `mode`, spelled as `tyco-ctl --help` lists it */
export function modeCliCall(mode: string): string {
  if (/^commandLauncher[2-5]$/.test(mode)) return `tyco --mode=${mode}`
  return `tyco-ctl open ${CLI_MODES[mode] ?? mode}`
}
