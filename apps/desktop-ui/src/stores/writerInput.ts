import { defineStore } from 'pinia'
import { ref } from 'vue'

import { createDraftSession } from '../lib/history/draft-session'
import { shouldRestoreDraft } from '../lib/quick-input/draft-restore'
import { useHistoryStore } from './history'

export const useWriterInputStore = defineStore('writerInput', () => {
  const value = ref<string>('')
  const focusCount = ref<number>(0)
  const selectAllCount = ref<number>(0)
  /** The last text sent to the next step, offered again on ArrowUp. */
  const lastSubmitted = ref<string>('')
  let dismissedAt: number | null = null

  const historyStore = useHistoryStore()
  const drafts = createDraftSession(
    (text, replaceId) => historyStore.saveDraft(text, replaceId),
    (id) => historyStore.removeFromEditorHistory(id)
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

  /**
   * Drops a cancelled input (Esc) without a trace: nothing goes to the history
   * and a draft already saved there on a hide is removed
   */
  const discard = (): void => {
    value.value = ''
    lastSubmitted.value = ''
    void drafts.discard()
  }

  /** The window is hidden: the text survives that, but not a quit. */
  const snapshotDraft = (): Promise<void> => drafts.snapshot(value.value)

  /** The window lost focus: its text is offered again on the next opening. */
  const markDismissed = (): void => {
    dismissedAt = Date.now()
  }

  /**
   * Prepares the input for a new opening: keeps the text of a recent dismissal,
   * clears anything else. Returns whether the text was kept
   */
  const startSession = (): boolean => {
    const restore = shouldRestoreDraft(value.value, dismissedAt, Date.now())
    dismissedAt = null
    if (!restore) clear()

    return restore
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
    discard,
    snapshotDraft,
    markDismissed,
    startSession,
    rememberSubmitted,
    focus,
    focusAndSelectAll,
  }
})
