import type { HotkeyProviderInfo } from './generated/desktop-types'
import type { HotkeyId, UserConfig } from './user-config'

/** The hotkey id of the in-place correction of the selection, as in `hotkeys` */
export const INLINE_CORRECTION_HOTKEY_ID = 'selectionCorrection'

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
  Enter: 'Enter',
  Escape: 'Escape',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'ArrowUp',
  ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
  PrintScreen: 'PrintScreen',
  Pause: 'Pause',
  NumpadAdd: 'NumpadAdd',
  NumpadSubtract: 'NumpadSubtract',
  NumpadMultiply: 'NumpadMultiply',
  NumpadDivide: 'NumpadDivide',
  NumpadDecimal: 'NumpadDecimal',
  NumpadEnter: 'NumpadEnter',
}

/** The key at a physical position, as the global shortcut providers name it */
function keyFromCode(code: string | undefined): string | null {
  if (!code) return null
  const letter = /^Key([A-Z])$/.exec(code)
  if (letter) return letter[1]
  const digit = /^Digit([0-9])$/.exec(code)
  if (digit) return digit[1]
  if (/^Numpad[0-9]$/.test(code)) return code
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code
  return CODE_KEYS[code] ?? null
}

export interface HotkeyKeyboardEvent {
  key: string
  code?: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

/**
 * The key of a shortcut. Windows and X11 bind a letter by the character the
 * layout gives it, so a Latin letter is taken as typed (Z on QWERTZ is Z);
 * other layouts, e.g. Cyrillic, bind the key at the same position as QWERTY,
 * and so does macOS on every layout (`isPhysical`). Keys the providers cannot
 * bind give null.
 */
function shortcutKey(event: HotkeyKeyboardEvent, isPhysical: boolean) {
  // an event without a position, e.g. a synthetic one
  if (!event.code) {
    return /^[a-z0-9]$/i.test(event.key) ? event.key.toUpperCase() : null
  }
  if (
    !isPhysical &&
    /^Key[A-Z]$/.test(event.code ?? '') &&
    /^[a-z]$/i.test(event.key)
  ) {
    return event.key.toUpperCase()
  }
  return keyFromCode(event.code)
}

export function hotkeyFromKeyboardEvent(
  event: HotkeyKeyboardEvent,
  { isPhysical = false }: { isPhysical?: boolean } = {}
): string | null {
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return null
  const key = shortcutKey(event, isPhysical)
  if (!key) return null

  return normalizeHotkey(
    [
      event.ctrlKey && 'Ctrl',
      event.altKey && 'Alt',
      event.shiftKey && 'Shift',
      event.metaKey && 'Super',
      key,
    ]
      .filter(Boolean)
      .join('+')
  )
}

/** The platform the hotkeys are bound on */
export type HotkeyPlatform = HotkeyProviderInfo['platform']
