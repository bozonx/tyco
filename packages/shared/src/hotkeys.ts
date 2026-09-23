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

export function hotkeyFromKeyboardEvent(event: {
  key: string
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
      event.key,
    ]
      .filter(Boolean)
      .join('+')
  )
}

export type HotkeyApplyStatus =
  'ready' | 'conflict' | 'confirmation-required' | 'external'

export interface HotkeyApplyResult {
  status: HotkeyApplyStatus
  externalCommand?: string
  message?: string
}

export interface HotkeyProviderInfo {
  provider: 'portal' | 'global-shortcut' | 'external'
  canConfigure: boolean
  actions: Record<string, HotkeyApplyResult>
}
