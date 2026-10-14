import { ref } from 'vue'

import { insertAtCursor, type TextRange } from './insert-at-cursor'

export function createChatInputModel() {
  const value = ref<string>('')
  const focusRequestCount = ref<number>(0)
  /** Selection the input had when it lost focus */
  const selection = ref<TextRange | null>(null)
  /** Caret to restore on the next focus */
  const pendingCaret = ref<number | null>(null)

  // replace value
  const setValue = (newText: string): void => {
    value.value = newText
    selection.value = null
    pendingCaret.value = null
  }

  const clear = (): void => {
    value.value = ''
    selection.value = null
    pendingCaret.value = null
  }

  const requestFocus = (): void => {
    focusRequestCount.value++
  }

  const rememberSelection = (range: TextRange | null): void => {
    selection.value = range
  }

  /** Inserts at the remembered caret, or at the end, and focuses after it */
  const insertText = (text: string): void => {
    const result = insertAtCursor(value.value, selection.value, text)
    value.value = result.value
    selection.value = { start: result.caret, end: result.caret }
    pendingCaret.value = result.caret
    requestFocus()
  }

  const takePendingCaret = (): number | null => {
    const caret = pendingCaret.value
    pendingCaret.value = null
    return caret
  }

  return {
    value,
    focusRequestCount,
    selection,
    pendingCaret,
    setValue,
    requestFocus,
    clear,
    rememberSelection,
    insertText,
    takePendingCaret,
  }
}
