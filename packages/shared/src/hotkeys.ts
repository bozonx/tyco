import type { HotkeyProviderInfo } from './generated/desktop-types'
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
  const target = resolveHotkeyTarget(config, id)
  return target?.get() ?? ''
}

export function resolveHotkeyTarget(
  config: Pick<UserConfig, 'hotkeys' | 'launcherPages'>,
  id: string
): { get: () => string; set: (shortcut: string) => void } | null {
  if (id === INLINE_CORRECTION_HOTKEY_ID)
    return {
      get: () => config.hotkeys.selectionCorrection,
      set: (value) => {
        config.hotkeys.selectionCorrection = value
      },
    }
  if (id.startsWith(LAUNCHER_PAGE_HOTKEY_PREFIX)) {
    const page = config.launcherPages.find(
      (item) => item.id === id.slice(LAUNCHER_PAGE_HOTKEY_PREFIX.length)
    )
    return page
      ? {
          get: () => page.hotkey,
          set: (value) => {
            page.hotkey = value
          },
        }
      : null
  }
  if (!Object.hasOwn(config.hotkeys, id)) return null
  const key = id as HotkeyId
  return {
    get: () => config.hotkeys[key],
    set: (value) => {
      config.hotkeys[key] = value
    },
  }
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

/** The platform the hotkeys are bound on */
export type HotkeyPlatform = HotkeyProviderInfo['platform']
