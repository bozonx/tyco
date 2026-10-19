import { defineStore } from 'pinia'
import { onScopeDispose, watch } from 'vue'
import { useDesktopStore } from './desktop'

import { useLlmStore } from './llm'
import { createQuickCorrection } from '../lib/quick-input/quick-correction'

/**
 * The one corrector of the window, under the `core.correct` tool and the
 * correction steps alike: a correction made in advance for the quick input is
 * reused by whatever asks for the same text
 */
export const useTextCorrectionStore = defineStore('textCorrection', () => {
  const { correctText } = useLlmStore().actions

  const corrector = createQuickCorrection({
    // errors are shown by whoever needed the result
    correct: (text, signal) =>
      correctText(text, { signal, notifyError: false }),
  })

  const desktop = useDesktopStore()
  watch(
    () =>
      JSON.stringify([
        desktop.userConfig.llm,
        desktop.userConfig.aiRules?.correction,
      ]),
    corrector.invalidate,
    { flush: 'sync' }
  )
  onScopeDispose(corrector.dispose)

  return {
    correct: corrector.correct,
    getCachedCorrection: corrector.getCachedCorrection,
    schedulePrecorrection: corrector.schedulePrecorrection,
    cancel: corrector.cancel,
  }
})
