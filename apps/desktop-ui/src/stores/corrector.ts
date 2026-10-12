import { defineStore } from 'pinia'
import { onScopeDispose } from 'vue'

import { useCallAi } from '../composables/use-call-ai'
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

  onScopeDispose(corrector.cancel)

  return {
    correct: corrector.correct,
    peek: corrector.peek,
    speculate: corrector.speculate,
    cancel: corrector.cancel,
  }
})
