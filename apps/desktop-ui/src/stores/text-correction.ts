import { defineStore } from 'pinia'
import { onScopeDispose, watch } from 'vue'
import { useDesktopStore } from './desktop'

import { useLlmStore } from './llm'
import { createQuickCorrection } from '../lib/quick-input/quick-correction'
import { createLiveCorrection } from '../lib/quick-input/live-correction'

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

  const liveCorrector = createLiveCorrection({
    correct: (text, signal) =>
      correctText(text, { signal, notifyError: false }),
  })

  const getCachedCorrection = (text: string): string | undefined =>
    corrector.getCachedCorrection(text) ??
    liveCorrector.getCachedCorrection(text)

  const correct = async (
    text: string,
    signal: AbortSignal
  ): Promise<string> => {
    const liveCached = liveCorrector.getCachedCorrection(text)
    if (liveCached !== undefined) return liveCached
    return corrector.correct(text, signal)
  }

  const desktop = useDesktopStore()
  watch(
    () =>
      JSON.stringify([
        desktop.userConfig.llm,
        desktop.userConfig.llm?.tasks.correction.rule,
      ]),
    () => {
      corrector.invalidate()
      liveCorrector.invalidate()
    },
    { flush: 'sync' }
  )
  onScopeDispose(() => {
    corrector.dispose()
    liveCorrector.dispose()
  })

  return {
    correct,
    getCachedCorrection,
    schedulePrecorrection: corrector.schedulePrecorrection,
    cancel: corrector.cancel,

    liveStatus: liveCorrector.status,
    liveCorrectedText: liveCorrector.correctedText,
    handleLiveInput: liveCorrector.handleInput,
    getFinalCorrection: liveCorrector.getFinalCorrection,
    cancelLive: liveCorrector.cancel,
    resetLive: liveCorrector.reset,
  }
})
