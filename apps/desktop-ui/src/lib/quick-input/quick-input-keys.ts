import {
  DEFAULT_QUICK_INPUT_HOTKEYS,
  hotkeyFromKeyboardEvent,
  normalizeHotkey,
  type QuickInputAction,
  type QuickInputHotkeys,
} from '@tyco/shared'

export interface QuickInputKeyEvent {
  code: string
  key?: string
  shiftKey?: boolean
  altKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  isComposing?: boolean
  repeat?: boolean
}

export function quickInputShortcut(event: QuickInputKeyEvent): string | null {
  if (event.isComposing) return null
  const key = event.key || event.code.replace(/^Key/, '')
  if (!event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
    if (['Enter', 'Tab'].includes(event.code)) return event.code
    if (['Escape', 'Esc'].includes(event.code)) return 'Esc'
    return null
  }
  return hotkeyFromKeyboardEvent({
    key,
    code: event.code,
    ctrlKey: Boolean(event.ctrlKey),
    altKey: Boolean(event.altKey),
    shiftKey: Boolean(event.shiftKey),
    metaKey: Boolean(event.metaKey),
  })
}

/** Invalid or conflicting saved bindings fall back to a usable default set. */
export function resolveQuickInputHotkeys(
  saved?: Partial<QuickInputHotkeys>
): QuickInputHotkeys {
  const result = { ...DEFAULT_QUICK_INPUT_HOTKEYS }
  for (const action of Object.keys(result) as QuickInputAction[]) {
    const value = saved?.[action]
    if (value === '' && action === 'insertWithoutCorrection')
      result[action] = ''
    else if (value) {
      if (['Escape', 'Esc'].includes(value)) {
        result[action] = 'Esc'
      } else if (['Enter', 'Tab'].includes(value)) {
        result[action] = value
      } else {
        result[action] = normalizeHotkey(value) ?? result[action]
      }
    }
  }
  const values = Object.values(result).filter(Boolean)
  return new Set(values).size === values.length
    ? result
    : { ...DEFAULT_QUICK_INPUT_HOTKEYS }
}

export function resolveQuickInputKeyAction(
  event: QuickInputKeyEvent,
  hotkeys: QuickInputHotkeys = DEFAULT_QUICK_INPUT_HOTKEYS
): QuickInputAction | 'none' {
  const shortcut = quickInputShortcut(event)
  if (!shortcut) return 'none'
  return (
    (Object.keys(hotkeys) as QuickInputAction[]).find(
      (action) => hotkeys[action] === shortcut
    ) ?? 'none'
  )
}
