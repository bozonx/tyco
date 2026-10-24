import { ref } from 'vue'

import {
  type TimerDependencies,
  createSingleTimer,
} from '../timers/single-timer'

/** How long a copy button shows that it copied */
export const COPIED_FEEDBACK_MS = 2000

export interface CopyValueDependencies extends TimerDependencies {
  writeText: (text: string) => Promise<void>
  /** Tells that the clipboard refused the text */
  reportFailure: () => void
  feedbackMs?: number
}

/**
 * Copies a value such as a path or an id as plain text and remembers for a
 * moment which one was copied, so its button can show it
 */
export function createCopyValue(deps: CopyValueDependencies) {
  const timer = createSingleTimer(deps)
  const copiedKey = ref<string | null>(null)

  /** `key` tells apart the values one view copies */
  const copy = async (value: string, key = 'value'): Promise<boolean> => {
    try {
      await deps.writeText(value)
    } catch {
      deps.reportFailure()
      return false
    }
    copiedKey.value = key
    timer.start(() => {
      copiedKey.value = null
    }, deps.feedbackMs ?? COPIED_FEEDBACK_MS)
    return true
  }

  const isCopied = (key = 'value') => copiedKey.value === key

  /** Stops the pending reset, e.g. when the view goes away */
  const dispose = () => {
    timer.stop()
    copiedKey.value = null
  }

  return { copiedKey, copy, isCopied, dispose }
}
