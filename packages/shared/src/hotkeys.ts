import type { HotkeyId, UserConfig } from './user-config'

/** The hotkey id of the in-place correction of the selection */
export const INLINE_CORRECTION_HOTKEY_ID = 'replace.correction'

/** Hotkey ids of command overlay pages carry this prefix and the page id */
export const LAUNCHER_PAGE_HOTKEY_PREFIX = 'launcherPage.'

export const launcherPageHotkeyId = (pageId: string) =>
  `${LAUNCHER_PAGE_HOTKEY_PREFIX}${pageId}`

/** The activation mode that opens the command overlay on a page */
export const launcherPageMode = (pageId: string) => `commandLauncher:${pageId}`

/** The shortcut saved for a hotkey id; empty when there is none */
export function configuredHotkey(
  config: Pick<UserConfig, 'hotkeys' | 'launcherPages'>,
  id: string
): string {
  if (id === INLINE_CORRECTION_HOTKEY_ID)
    return config.hotkeys.selectionCorrection
  if (id.startsWith(LAUNCHER_PAGE_HOTKEY_PREFIX)) {
    const pageId = id.slice(LAUNCHER_PAGE_HOTKEY_PREFIX.length)
    return config.launcherPages.find((page) => page.id === pageId)?.hotkey ?? ''
  }
  return Object.hasOwn(config.hotkeys, id) ? config.hotkeys[id as HotkeyId] : ''
}

export const HOTKEY_MODIFIERS = ['Ctrl', 'Alt', 'Shift', 'Super'] as const

export type HotkeyModifier = (typeof HOTKEY_MODIFIERS)[number]

const MODIFIER_ALIASES: Record<string, HotkeyModifier> = {
  control: 'Ctrl',
  ctrl: 'Ctrl',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
  meta: 'Super',
  super: 'Super',
  cmd: 'Super',
  command: 'Super',
}

const KEY_ALIASES: Record<string, string> = {
  ' ': 'Space',
  spacebar: 'Space',
  escape: 'Escape',
  esc: 'Escape',
  ',': 'Comma',
  '.': 'Period',
}

export function normalizeHotkey(value: string): string | null {
  const parts = value
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
  const modifiers = new Set<HotkeyModifier>()
  let key = ''

  for (const part of parts) {
    const modifier = MODIFIER_ALIASES[part.toLowerCase()]
    if (modifier) {
      modifiers.add(modifier)
    } else if (key) {
      return null
    } else {
      const lower = part.toLowerCase()
      key =
        KEY_ALIASES[lower] ||
        (part.length === 1
          ? part.toUpperCase()
          : `${part[0].toUpperCase()}${part.slice(1)}`)
    }
  }

  if (!key || modifiers.size === 0) return null

  return [
    ...HOTKEY_MODIFIERS.filter((modifier) => modifiers.has(modifier)),
    key,
  ].join('+')
}

const CODE_KEYS: Record<string, string> = {
  Space: 'Space',
  Comma: 'Comma',
  Period: 'Period',
  Minus: 'Minus',
  Equal: 'Equal',
  Slash: 'Slash',
  Backslash: 'Backslash',
  Semicolon: 'Semicolon',
  Quote: 'Quote',
  BracketLeft: 'BracketLeft',
  BracketRight: 'BracketRight',
  Backquote: 'Backquote',
}

/**
 * Resolves the physical key, so that a shortcut recorded under a non-Latin
 * layout (or with Shift held) matches what the global shortcut providers bind.
 */
function keyFromCode(code: string | undefined): string | null {
  if (!code) return null
  const letter = /^Key([A-Z])$/.exec(code)
  if (letter) return letter[1]
  const digit = /^(?:Digit|Numpad)([0-9])$/.exec(code)
  if (digit) return digit[1]
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code
  return CODE_KEYS[code] ?? null
}

export function hotkeyFromKeyboardEvent(event: {
  key: string
  code?: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}): string | null {
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return null

  return normalizeHotkey(
    [
      event.ctrlKey && 'Ctrl',
      event.altKey && 'Alt',
      event.shiftKey && 'Shift',
      event.metaKey && 'Super',
      keyFromCode(event.code) ?? event.key,
    ]
      .filter(Boolean)
      .join('+')
  )
}

export type HotkeyApplyStatus = 'ready' | 'conflict' | 'external'

export interface HotkeyApplyResult {
  status: HotkeyApplyStatus
  externalCommand?: string
  message?: string
}

export type HotkeyProviderKind = 'portal' | 'global-shortcut' | 'external'

export type HotkeyPlatform = 'linux' | 'windows' | 'macos'

export interface HotkeyProviderInfo {
  provider: HotkeyProviderKind
  canConfigure: boolean
  /** Only external bindings report something per action: their command */
  actions: Record<string, HotkeyApplyResult>
  /** Shortcuts the desktop bound through the portal, in its own words */
  systemTriggers: Record<string, string>
  /**
   * The portal session is bound, so `systemTriggers` is what the desktop has
   * and a missing id was removed there
   */
  registered: boolean
  /** The default shortcut of every hotkey id on this platform */
  defaults: Record<string, string>
  platform: HotkeyPlatform
}

export interface HotkeyApplyRequest {
  mode: string
  shortcut: string
}
