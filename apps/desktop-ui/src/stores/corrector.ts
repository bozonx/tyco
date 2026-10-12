import { defineStore } from 'pinia'
import { onScopeDispose, watch } from 'vue'
import { useIpcStore } from './ipc'

import { useLlmActions } from '../composables/use-llm-actions'
import { createQuickCorrection } from '../lib/quick-input/quick-correction'

/**
 * The one corrector of the window, under the `core.correct` tool and the
 * correction steps alike: a correction made in advance for the quick input is
 * reused by whatever asks for the same text
 */
export const useCorrectorStore = defineStore('corrector', () => {
  const { correctText } = useLlmActions()

  const corrector = createQuickCorrection({
    // errors are shown by whoever needed the result
    correct: (text, signal) =>
      correctText(text, { signal, notifyError: false }),
  })

  const ipc = useIpcStore()
  watch(
    () =>
      JSON.stringify([
        ipc.params.userConfig.llm,
        ipc.params.userConfig.aiRules?.correction,
        ipc.params.appConfig.aiInstructions.correction,
        ipc.params.appConfig.rulePrefix,
      ]),
    corrector.invalidate,
    { flush: 'sync' }
  )
  onScopeDispose(corrector.dispose)

  return {
    correct: corrector.correct,
    peek: corrector.peek,
    speculate: corrector.speculate,
    cancel: corrector.cancel,
  }
})
