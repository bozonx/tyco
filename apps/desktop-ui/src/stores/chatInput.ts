import { defineStore } from 'pinia'
import { ref } from 'vue'

import { insertAtCursor, type TextRange } from '../lib/chat/insert-at-cursor'

export const useChatInputStore = defineStore('chatInput', () => {
  const value = ref<string>('')
  const focusCount = ref<number>(0)
  /** Selection the input had when it lost the focus */
  const selection = ref<TextRange | null>(null)
  /** Caret to restore on the next focus */
  const pendingCaret = ref<number | null>(null)

  // replace value
  const setValue = (newText: string): void => {
    value.value = newText
  }

  const clear = (): void => {
    value.value = ''
    selection.value = null
  }

  const focus = (): void => {
    focusCount.value++
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
    focus()
  }

  const takePendingCaret = (): number | null => {
    const caret = pendingCaret.value
    pendingCaret.value = null
    return caret
  }

  return {
    value,
    focusCount,
    setValue,
    focus,
    clear,
    rememberSelection,
    insertText,
    takePendingCaret,
  }
})
