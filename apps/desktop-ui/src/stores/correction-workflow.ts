import { defineStore } from 'pinia'
import { onScopeDispose } from 'vue'

import { useToastStore } from './toast'
import { createCorrectionStep } from '../lib/correction/correction-step'
import { translate } from '../lib/i18n'
import { toolResultMessage } from '../lib/invocation/invocation-result'
import { describeError } from '../lib/errors/describe-error'
import {
  CorrectionAbortedError,
  isCorrectionAborted,
} from '../lib/quick-input/quick-correction'
import {
  createQuickInsert,
  type QuickInsertDependencies,
} from '../lib/quick-input/quick-insert'
import { useBufferedIntent } from '../composables/use-buffered-intent'
import { useTextCorrectionStore } from './text-correction'
import { useHistoryStore } from './history'
import { useQuickInputStore } from './quick-input'
import { useInvocationsStore } from './invocations'
import { MenuModals, useMenuModalsStore } from './menu-modals'

export const useCorrectionWorkflowStore = defineStore(
  'correctionWorkflow',
  () => {
    const { toastKey, toastText } = useToastStore()
    const menuModalsStore = useMenuModalsStore()
    const historyStore = useHistoryStore()
    const quickInput = useQuickInputStore()

    const runBufferedIntent = useBufferedIntent()

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
      getCachedCorrection: corrector.getCachedCorrection,
      openStep: (params) =>
        menuModalsStore.nextModal(MenuModals.INSERT, params),
      setPending: (params) => menuModalsStore.setPendingModal(params),
      clearPending: (owner) =>
        menuModalsStore.clearPendingModal(owner ?? undefined),
      isPending: (owner) =>
        owner !== undefined && menuModalsStore.isPendingModal(owner),
      consumeBufferedIntent: menuModalsStore.consumeBufferedIntent,
      executeBufferedIntent: runBufferedIntent,
      saveResult: async (text, result) => {
        try {
          const sourceId = await historyStore.saveSource(text, 'correction')
          await historyStore.saveSourceResult(sourceId, result)
        } catch {
          toastKey('history.operationFailed', 'error')
        }
      },
      reportError: (error) => {
        toastText(describeError(error, translate), 'error')
      },
      isAborted: isCorrectionAborted,
    })

    const createInsertCorrector = () => {
      let controller: AbortController | null = null
      return {
        correct: (text: string) => {
          const cached = corrector.getCachedCorrection(text)
          if (cached !== undefined) return Promise.resolve(cached)
          controller?.abort()
          controller = new AbortController()
          return correct(text, controller.signal)
        },
        cancelCorrection: () => {
          controller?.abort()
          corrector.cancelLive()
        },
      }
    }
    const quickInsertDependencies: Omit<
      QuickInsertDependencies,
      'correct' | 'cancelCorrection'
    > = {
      saveOutput: (text: string) => historyStore.saveOutput(text, 'quickInput'),
      saveSource: (text: string) => quickInput.saveSource(text, 'correction'),
      saveDraft: () => quickInput.flushHistory(),
      saveSourceResult: historyStore.saveSourceResult,
      saveSourceFailure: historyStore.saveSourceFailure,
      describeError: (error: unknown) => describeError(error, translate),
      reportHistoryError: () => toastKey('history.operationFailed', 'error'),
      // a failed insertion is reported by the tool: the window may be gone
      insert: async (text: string) => {
        const result = await invocations.call('core.insert', text)
        if (!result.ok) throw new Error(toolResultMessage(result, translate))
      },
      openStep: (params) =>
        menuModalsStore.nextModal(MenuModals.INSERT, params),
      setPending: (onCancel, options) =>
        menuModalsStore.setPendingModal({
          ...(options?.direct ? {} : { correction: true }),
          ...(options?.allowBufferedIntent
            ? { allowBufferedIntent: true }
            : {}),
          onCancel,
        }),
      clearPending: (owner?: number | void) =>
        menuModalsStore.clearPendingModal(owner ?? undefined),
      isPending: (owner) =>
        owner !== undefined && menuModalsStore.isPendingModal(owner),
      consumeBufferedIntent: menuModalsStore.consumeBufferedIntent,
      executeBufferedIntent: runBufferedIntent,
      reportError: (error: unknown) =>
        toastText(describeError(error, translate), 'error'),
      isAborted: isCorrectionAborted,
    }
    const quickInsert = createQuickInsert({
      ...quickInsertDependencies,
      ...createInsertCorrector(),
    })
    const directCorrection = createQuickInsert({
      ...quickInsertDependencies,
      ...createInsertCorrector(),
      saveSource: (text) => historyStore.saveSource(text, 'correction'),
      saveOutput: (text) => historyStore.saveOutput(text),
    })

    onScopeDispose(() => {
      step.dispose()
      quickInsert.dispose()
      directCorrection.dispose()
    })

    return {
      insert: quickInsert.start,
      correctAndInsert: directCorrection.start,
      insertLive: (text: string) =>
        quickInsert.start(text, (t) => corrector.getFinalCorrection(t)),
      nextLive: (text: string) =>
        quickInsert.next(text, (t) => corrector.getFinalCorrection(t)),
      insertDirect: quickInsert.insertDirect,
      cancelInsert: quickInsert.cancel,
      /** Opens a step with the correction of `text` over the current one. */
      start: step.start,
      /** Corrects `text` in advance once the user pauses; null drops it. */
      schedulePrecorrection: corrector.schedulePrecorrection,
      /** Stops a correction made in advance; a finished one stays reusable. */
      cancelPrecorrection: corrector.cancel,
    }
  }
)
