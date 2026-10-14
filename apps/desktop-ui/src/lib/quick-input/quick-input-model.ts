import { ref } from 'vue'

import { createQuickInputSession } from './quick-input-session'

export interface QuickInputDependencies {
  now?: () => number
}

export function createQuickInputModel(deps: QuickInputDependencies = {}) {
  const value = ref<string>('')
  const focusRequestCount = ref<number>(0)
  const selectAllRequestCount = ref<number>(0)
  /** The last text sent on or cancelled, offered again on ArrowUp. */
  const recallText = ref<string>('')

  const session = createQuickInputSession(deps.now)
  const syncRecall = (): void => {
    recallText.value = session.recallText
  }

  // replace value
  const setValue = (newText: string): void => {
    value.value = newText
  }

  /** Empties the input; the text stays recallable in memory. */
  const clear = (): void => {
    session.end(value.value)
    syncRecall()
    value.value = ''
  }

  /** Clears a cancelled input (Esc); ArrowUp brings it back. */
  const discard = (): void => {
    session.discard(value.value)
    syncRecall()
    value.value = ''
  }

  /**
   * The window lost requestFocus: its text is offered again on the next
   * opening.
   */
  const markDismissed = (): void => {
    session.markDismissed()
  }

  /**
   * Prepares the input for a new opening: keeps the text of a recent dismissal,
   * clears anything else. Returns whether the text was kept
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

  const requestFocus = (): void => {
    focusRequestCount.value++
  }

  const requestFocusAndSelectAll = (): void => {
    selectAllRequestCount.value++
  }

  return {
    value,
    focusRequestCount,
    selectAllRequestCount,
    recallText,
    setValue,
    clear,
    discard,
    markDismissed,
    startSession,
    rememberSubmitted,
    requestFocus,
    requestFocusAndSelectAll,
  }
}
