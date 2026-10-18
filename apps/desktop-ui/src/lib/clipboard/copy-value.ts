import { ref } from 'vue'

/** How long a copy button shows that it copied */
export const COPIED_FEEDBACK_MS = 2000

export interface CopyValueDependencies {
  writeText: (text: string) => Promise<void>
  /** Tells that the clipboard refused the text */
  reportFailure: () => void
  feedbackMs?: number
  setTimer?: (run: () => void, delayMs: number) => unknown
  clearTimer?: (timer: unknown) => void
}

/**
 * Copies a value such as a path or an id as plain text and remembers for a
 * moment which one was copied, so its button can show it
 */
export function createCopyValue(deps: CopyValueDependencies) {
  const setTimer =
    deps.setTimer ?? ((run, delayMs) => globalThis.setTimeout(run, delayMs))
  const clearTimer =
    deps.clearTimer ??
    ((timer) => globalThis.clearTimeout(timer as ReturnType<typeof setTimeout>))
  const copiedKey = ref<string | null>(null)
  let timer: unknown = null

  const reset = () => {
    if (timer !== null) clearTimer(timer)
    timer = null
  }

  /** `key` tells apart the values one view copies */
  const copy = async (value: string, key = 'value'): Promise<boolean> => {
    try {
      await deps.writeText(value)
    } catch {
      deps.reportFailure()
      return false
    }
    reset()
    copiedKey.value = key
    timer = setTimer(() => {
      timer = null
      copiedKey.value = null
    }, deps.feedbackMs ?? COPIED_FEEDBACK_MS)
    return true
  }

  const isCopied = (key = 'value') => copiedKey.value === key

  /** Stops the pending reset, e.g. when the view goes away */
  const dispose = () => {
    reset()
    copiedKey.value = null
  }

  return { copiedKey, copy, isCopied, dispose }
}
