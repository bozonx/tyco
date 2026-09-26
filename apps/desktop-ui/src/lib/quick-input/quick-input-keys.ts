import type { QuickInputSubmitMode } from '@tyco/shared'

/**
 * `submitAlt` submits the opposite way to the submit key: with correction when
 * that one goes without it, and without when it corrects
 */
export type QuickInputKeyAction = 'submit' | 'submitAlt' | 'cancel' | 'none'

export interface QuickInputKeyEvent {
  code: string
  shiftKey?: boolean
  altKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
}

export function resolveQuickInputKeyAction(
  event: QuickInputKeyEvent,
  submitMode: QuickInputSubmitMode = 'enter'
): QuickInputKeyAction {
  if (event.code === 'Escape') {
    return 'cancel'
  }

  if (event.code === 'Enter') {
    // Alt+Enter is the same in both modes
    if (event.altKey) {
      return event.shiftKey ? 'none' : 'submitAlt'
    }

    const hasModifier = Boolean(event.ctrlKey || event.metaKey)

    if (submitMode === 'ctrlEnter') {
      return hasModifier ? 'submit' : 'none'
    }

    // In 'enter' mode: Enter (without Shift) or Ctrl/Cmd+Enter submits. Shift+Enter produces newline.
    if (hasModifier || !event.shiftKey) {
      return 'submit'
    }

    return 'none'
  }

  return 'none'
}
