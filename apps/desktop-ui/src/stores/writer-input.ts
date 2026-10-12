import { defineStore } from 'pinia'
import { ref } from 'vue'

import { createDraftSession } from '../lib/history/draft-session'
import { createQuickInputSession } from '../lib/quick-input/quick-input-session'
import { useHistoryStore } from './history'

export const useWriterInputStore = defineStore('writerInput', () => {
  const value = ref<string>('')
  const focusCount = ref<number>(0)
  const selectAllCount = ref<number>(0)
  /** The last text sent on or cancelled, offered again on ArrowUp. */
  const recallText = ref<string>('')

  const historyStore = useHistoryStore()
  const session = createQuickInputSession(
    createDraftSession(
      (text, replaceId) => historyStore.saveDraft(text, replaceId),
      (id) => historyStore.removeFromEditorHistory(id)
    )
  )
  const syncRecall = (): void => {
    recallText.value = session.recallText
  }

  // replace value
  const setValue = (newText: string): void => {
    value.value = newText
  }

  /** Empties the input; the text it held goes to the history. */
  const clear = (): void => {
    session.end(value.value)
    syncRecall()
    value.value = ''
  }

  /** Drops a cancelled input (Esc) from the history; ArrowUp brings it back. */
  const discard = (): void => {
    session.discard(value.value)
    syncRecall()
    value.value = ''
  }

  /** The window is hidden: the text survives that, but not a quit. */
  const snapshotDraft = (): Promise<void> => session.snapshot(value.value)

  /** The window lost focus: its text is offered again on the next opening. */
  const markDismissed = (): void => {
    session.markDismissed()
  }

  /**
   * Prepares the input for a new opening: keeps the text of a recent dismissal,
   * moves anything else to the history. Returns whether the text was kept
   */
  const startSession = (): boolean => {
    const kept = session.start(value.value)
    syncRecall()
    if (!kept) value.value = ''

    return kept
  }

  const rememberSubmitted = (text: string): void => {
    session.submitted(text)
    syncRecall()
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
    recallText,
    setValue,
    clear,
    discard,
    snapshotDraft,
    markDismissed,
    startSession,
    rememberSubmitted,
    focus,
    focusAndSelectAll,
  }
})
