import { ref } from 'vue'

/**
 * The text of the quick input.
 *
 * - Unfinished text survives window hiding and reactivation: a failed or
 *   cancelled insertion, or a closed actions step, leaves it in the input.
 * - Text that left the app (inserted or copied) and text cleared with Esc are
 *   gone from the input on the next opening.
 *
 * Intentional: the input keeps no copy of earlier text, e.g. to bring it back
 * on ArrowUp. The history is the only store of user input, and with the history
 * turned off nothing the user typed is kept once the input is done with it
 */
export function createQuickInputModel() {
  const value = ref<string>('')
  const focusRequestCount = ref<number>(0)
  const selectAllRequestCount = ref<number>(0)
  /** The text left the app; the next opening starts empty */
  let isFinished = false

  // replace value
  const setValue = (newText: string): void => {
    value.value = newText
  }

  /** Empties the input. */
  const clear = (): void => {
    value.value = ''
  }

  /** Esc: the user dropped the text on purpose. */
  const discard = (): void => {
    value.value = ''
  }

  /** The text was inserted or copied: the next opening starts empty. */
  const finish = (): void => {
    isFinished = true
  }

  /**
   * Prepares the input for a new opening: keeps unfinished text, clears
   * finished text. Returns whether the text was kept
   */
  const startSession = (): boolean => {
    const kept = !isFinished && Boolean(value.value.trim())
    isFinished = false
    if (!kept) value.value = ''

    return kept
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
    setValue,
    clear,
    discard,
    finish,
    startSession,
    requestFocus,
    requestFocusAndSelectAll,
  }
}
