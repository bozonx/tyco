import { defineStore } from 'pinia'

import { useCallAi } from '../composables/useCallAi'
import useToast from '../composables/useToast'
import { createCorrectionStep } from '../lib/correction/correction-step'
import { translate } from '../lib/i18n'
import { LlmError } from '../lib/llm/llm-client'
import { formatLlmError } from '../lib/llm/llm-errors'
import {
  createQuickCorrection,
  isCorrectionAborted,
} from '../lib/quick-input/quick-correction'
import { useHistoryStore } from './history'
import { MenuModals, useMenuModalsStore } from './menuModals'

function describeError(error: unknown): string {
  if (error instanceof LlmError) return formatLlmError(error, translate)
  return error instanceof Error ? error.message : String(error)
}

export const useCorrectionStore = defineStore('correction', () => {
  const { correctText } = useCallAi()
  const { toast, toastText } = useToast()
  const menuModalsStore = useMenuModalsStore()
  const historyStore = useHistoryStore()

  // one corrector for the whole window: a correction made in advance for the
  // quick input is reused by whatever asks for the same text
  const corrector = createQuickCorrection({
    // errors are shown by the step that needed the result
    correct: (text, signal) =>
      correctText(text, { signal, notifyError: false }),
  })

  const step = createCorrectionStep({
    correct: (text, signal) => {
      signal.addEventListener('abort', () => corrector.cancel(), { once: true })
      return corrector.request(text)
    },
    peek: corrector.peek,
    openStep: (params) => menuModalsStore.nextModal(MenuModals.INSERT, params),
    updateStep: menuModalsStore.updateStep,
    setPending: (params) => menuModalsStore.setPendingModal(params),
    clearPending: () => menuModalsStore.clearPendingModal(),
    saveResult: async (text, result) => {
      try {
        const sourceId = await historyStore.saveSource(text, 'correction')
        await historyStore.saveSourceResult(sourceId, result)
      } catch {
        toast('history.operationFailed', 'error')
      }
    },
    reportError: (error) => {
      const message = describeError(error)
      toastText(message, 'error')
      return message
    },
    isAborted: isCorrectionAborted,
  })

  return {
    /** Opens a step with the correction of `text` over the current one. */
    start: step.start,
    /** Corrects `text` in advance once the user pauses; null drops it. */
    speculate: corrector.speculate,
    /** Stops a correction made in advance; a finished one stays reusable. */
    cancelSpeculation: corrector.cancel,
  }
})
