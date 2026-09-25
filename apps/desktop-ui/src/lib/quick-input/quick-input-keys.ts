import type { QuickInputSubmitMode } from '@tyco/shared'

export type QuickInputKeyAction = 'submit' | 'cancel' | 'none'

export interface QuickInputKeyEvent {
  code: string
  shiftKey?: boolean
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
