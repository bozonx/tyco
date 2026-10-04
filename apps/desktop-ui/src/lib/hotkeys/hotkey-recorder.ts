import { type HotkeyPlatform, hotkeyFromKeyboardEvent } from '@tyco/shared'

export interface HotkeyKeyEvent {
  key: string
  code?: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

/** What a key press means while a shortcut is being recorded. */
export type HotkeyRecordStep =
  /** Escape without modifiers stops recording and keeps the old shortcut */
  | { kind: 'cancel' }
  /** Only modifiers are held so far */
  | { kind: 'pending'; keys: string[] }
  /** A key without modifiers, which global shortcuts do not accept */
  | { kind: 'invalid'; keys: string[] }
  | { kind: 'done'; shortcut: string }

const MODIFIER_KEYS = ['Control', 'Alt', 'Shift', 'Meta']

export function heldModifiers(event: HotkeyKeyEvent): string[] {
  return [
    event.ctrlKey && 'Ctrl',
    event.altKey && 'Alt',
    event.shiftKey && 'Shift',
    event.metaKey && 'Super',
  ].filter((modifier): modifier is string => Boolean(modifier))
}

function keyLabel(event: HotkeyKeyEvent): string {
  return event.key.length === 1 ? event.key.toUpperCase() : event.key
}

export function recordKeyDown(event: HotkeyKeyEvent): HotkeyRecordStep {
  const modifiers = heldModifiers(event)
  if (MODIFIER_KEYS.includes(event.key)) {
    return { kind: 'pending', keys: modifiers }
  }
  if (event.key === 'Escape' && modifiers.length === 0) {
    return { kind: 'cancel' }
  }
  const shortcut = hotkeyFromKeyboardEvent(event)
  return shortcut
    ? { kind: 'done', shortcut }
    : { kind: 'invalid', keys: [...modifiers, keyLabel(event)] }
}

/**
 * Splits a shortcut into its keys. A `+` at the end is the key itself, as in
 * the `Ctrl++` a desktop may report.
 */
export function shortcutKeys(shortcut: string): string[] {
  return shortcut
    .split(/\+(?!$)/)
    .map((key) => key.trim())
    .filter(Boolean)
}

const MAC_KEY_LABELS: Record<string, string> = {
  Ctrl: '⌃',
  Alt: '⌥',
  Shift: '⇧',
  Super: '⌘',
}

/** How the platform names a key: macOS shows modifier symbols. */
export function keyLabelFor(key: string, platform: HotkeyPlatform): string {
  if (platform === 'macos') return MAC_KEY_LABELS[key] ?? key
  if (platform === 'windows' && key === 'Super') return 'Win'
  return key
}
