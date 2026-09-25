import { defineStore } from 'pinia'
import { ref } from 'vue'

import { createDraftSession } from '../lib/history/draft-session'
import { useHistoryStore } from './history'

export const useWriterInputStore = defineStore('writerInput', () => {
  const value = ref<string>('')
  const focusCount = ref<number>(0)
  const selectAllCount = ref<number>(0)
  /** The last text sent to the next step, offered again on ArrowUp. */
  const lastSubmitted = ref<string>('')

  const historyStore = useHistoryStore()
  const drafts = createDraftSession((text, replaceId) =>
    historyStore.saveDraft(text, replaceId)
  )

  // replace value
  const setValue = (newText: string): void => {
    value.value = newText
  }

  /** Empties the input; the text it held goes to the history. */
  const clear = (): void => {
    void drafts.end(value.value)
    value.value = ''
  }

  /** The window is hidden: the text survives that, but not a quit. */
  const snapshotDraft = (): Promise<void> => drafts.snapshot(value.value)

  /** The window lost focus. */
  const markDismissed = (): void => {}

  /** Prepares the input for a new opening: always starts with a clean string. */
  const startSession = (): boolean => {
    clear()
    return false
  }

  const rememberSubmitted = (text: string): void => {
    if (text.trim()) lastSubmitted.value = text
  }

  const focus = (): void => {
    focusCount.value++
  }

  const focusAndSelectAll = (): void => {
    selectAllCount.value++
  }

  return {
    value,
    focusCount,
    selectAllCount,
    lastSubmitted,
    setValue,
    clear,
    snapshotDraft,
    markDismissed,
    startSession,
    rememberSubmitted,
    focus,
    focusAndSelectAll,
  }
})
