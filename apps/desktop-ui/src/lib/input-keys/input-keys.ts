import { DEFAULT_SUBMIT_KEY, SUBMIT_KEYS, type SubmitKey } from '@tyco/shared'

export interface InputKeyEvent {
  code: string
  shiftKey?: boolean
  altKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  isComposing?: boolean
}

/**
 * What a key does in a multi-line input. `actions` is Tab in the quick input;
 * the other inputs leave it to the browser
 */
export type InputKeyAction = 'submit' | 'newline' | 'actions' | 'cancel'

/** Opens the quick actions panel of the editor, whatever sends the text. */
export const EDITOR_ACTIONS_SHORTCUT = 'Ctrl+Enter'

export function resolveSubmitKey(saved: unknown): SubmitKey {
  return SUBMIT_KEYS.includes(saved as SubmitKey)
    ? (saved as SubmitKey)
    : DEFAULT_SUBMIT_KEY
}

export function submitShortcut(submitKey: SubmitKey): string {
  return submitKey === 'ctrlEnter' ? 'Ctrl+Enter' : 'Enter'
}

export function newlineShortcut(submitKey: SubmitKey): string {
  return submitKey === 'ctrlEnter' ? 'Enter' : 'Shift+Enter'
}

const isEnter = (event: InputKeyEvent) =>
  event.code === 'Enter' || event.code === 'NumpadEnter'

const onlyCtrl = (event: InputKeyEvent) =>
  Boolean(event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey

const noModifiers = (event: InputKeyEvent) =>
  !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey

/** Ctrl+Enter, or Cmd+Enter on macOS. */
export function isCtrlEnter(event: InputKeyEvent): boolean {
  return isEnter(event) && !event.isComposing && onlyCtrl(event)
}

export function resolveInputKeyAction(
  event: InputKeyEvent,
  submitKey: SubmitKey = DEFAULT_SUBMIT_KEY
): InputKeyAction | 'none' {
  if (event.isComposing) return 'none'
  if (event.code === 'Escape' && noModifiers(event)) return 'cancel'
  if (event.code === 'Tab' && noModifiers(event)) return 'actions'
  if (!isEnter(event)) return 'none'

  if (noModifiers(event)) return submitKey === 'enter' ? 'submit' : 'newline'
  if (onlyCtrl(event)) return submitKey === 'ctrlEnter' ? 'submit' : 'none'
  if (event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey)
    return 'newline'
  return 'none'
}
