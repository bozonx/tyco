import { defineStore } from 'pinia'
import { ref } from 'vue'

import { createDraftSession } from '../lib/history/draft-session'
import { useHistoryStore } from './history'

export const useWriterInputStore = defineStore('writerInput', () => {
  const value = ref<string>('')
  const focusCount = ref<number>(0)

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

  const focus = (): void => {
    focusCount.value++
  }

  return { value, focusCount, setValue, clear, snapshotDraft, focus }
})
