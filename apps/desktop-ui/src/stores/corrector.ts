import { defineStore } from 'pinia'

import { useCallAi } from '../composables/useCallAi'
import { createQuickCorrection } from '../lib/quick-input/quick-correction'

/**
 * The one corrector of the window, under the `core.correct` tool and the
 * correction steps alike: a correction made in advance for the quick input is
 * reused by whatever asks for the same text
 */
export const useCorrectorStore = defineStore('corrector', () => {
  const { correctText } = useCallAi()

  const corrector = createQuickCorrection({
    // errors are shown by whoever needed the result
    correct: (text, signal) =>
      correctText(text, { signal, notifyError: false }),
  })

  /** The correction of `text`; aborting `signal` stops the running one */
  const correct = (text: string, signal: AbortSignal): Promise<string> => {
    signal.addEventListener('abort', () => corrector.cancel(), { once: true })
    return corrector.request(text)
  }

  return {
    correct,
    peek: corrector.peek,
    speculate: corrector.speculate,
    cancel: corrector.cancel,
  }
})
