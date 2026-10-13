import { defineStore } from 'pinia'
import { onScopeDispose } from 'vue'

import useToast from '../composables/use-toast'
import { createCorrectionStep } from '../lib/correction/correction-step'
import { translate } from '../lib/i18n'
import { toolResultMessage } from '../lib/invocation/invocation-result'
import { describeError } from '../lib/llm/llm-errors'
import {
  CorrectionAbortedError,
  isCorrectionAborted,
} from '../lib/quick-input/quick-correction'
import { createQuickInsert } from '../lib/quick-input/quick-insert'
import { useTextCorrectionStore } from './text-correction'
import { useHistoryStore } from './history'
import { useInvocationsStore } from './invocations'
import { MenuModals, useMenuModalsStore } from './menu-modals'

export const useCorrectionWorkflowStore = defineStore(
  'correctionWorkflow',
  () => {
    const { toast, toastText } = useToast()
    const menuModalsStore = useMenuModalsStore()
    const historyStore = useHistoryStore()

    const corrector = useTextCorrectionStore()
    const invocations = useInvocationsStore()

    /** The correction of `text` by the `core.correct` tool */
    const correct = async (text: string, signal: AbortSignal) => {
      const result = await invocations.call('core.correct', text, { signal })
      if (result.cancelled) throw new CorrectionAbortedError()
      if (!result.ok) throw new Error(toolResultMessage(result, translate))
      return result.content ?? ''
    }

    const step = createCorrectionStep({
      correct,
      peek: corrector.peek,
      openStep: (params) =>
        menuModalsStore.nextModal(MenuModals.INSERT, params),
      updateStep: menuModalsStore.updateStep,
      setPending: (params) => menuModalsStore.setPendingModal(params),
      clearPending: (owner) =>
        menuModalsStore.clearPendingModal(owner ?? undefined),
      isPending: (owner) =>
        owner !== undefined && menuModalsStore.isPendingModal(owner),
      saveResult: async (text, result) => {
        try {
          const sourceId = await historyStore.saveSource(text, 'correction')
          await historyStore.saveSourceResult(sourceId, result)
        } catch {
          toast('history.operationFailed', 'error')
        }
      },
      reportError: (error) => {
        const message = describeError(error, translate)
        toastText(message, 'error')
        return message
      },
      isAborted: isCorrectionAborted,
    })

    // the correction of the submission being inserted, to stop it
    let insertCorrection: AbortController | null = null
    const quickInsert = createQuickInsert({
      correct: (text) => {
        insertCorrection = new AbortController()
        return correct(text, insertCorrection.signal)
      },
      cancelCorrection: () => insertCorrection?.abort(),
      saveOutput: historyStore.saveOutput,
      // a failed insertion is reported by the tool: the window may be gone
      insert: async (text) => {
        const result = await invocations.call('core.insert', text)
        if (!result.ok) throw new Error(toolResultMessage(result, translate))
      },
      setPending: (onCancel) =>
        menuModalsStore.setPendingModal({ correction: true, onCancel }),
      clearPending: (owner) =>
        menuModalsStore.clearPendingModal(owner ?? undefined),
      reportError: (error) =>
        toastText(describeError(error, translate), 'error'),
    })

    onScopeDispose(() => {
      step.dispose()
      quickInsert.dispose()
    })

    return {
      insert: quickInsert.start,
      cancelInsert: quickInsert.cancel,
      /** Opens a step with the correction of `text` over the current one. */
      start: step.start,
      /** Corrects `text` in advance once the user pauses; null drops it. */
      speculate: corrector.speculate,
      /** Stops a correction made in advance; a finished one stays reusable. */
      cancelSpeculation: corrector.cancel,
    }
  }
)
