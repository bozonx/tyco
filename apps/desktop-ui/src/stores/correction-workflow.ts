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
import { createQuickInsert } from '../lib/quick-input/quick-insert'
import { useEditorNavigation } from '../composables/use-editor-navigation'
import { useDesktopStore } from './desktop'
import { useEditorInputStore } from './editor-input'
import { useTextCorrectionStore } from './text-correction'
import { useHistoryStore } from './history'
import { useInvocationsStore } from './invocations'
import { MenuModals, useMenuModalsStore } from './menu-modals'
import { useWindowStore } from './window'
import { isQuickWindow } from '../lib/desktop/window'

export const useCorrectionWorkflowStore = defineStore(
  'correctionWorkflow',
  () => {
    const { toastKey, toastText } = useToastStore()
    const menuModalsStore = useMenuModalsStore()
    const historyStore = useHistoryStore()
    const desktopStore = useDesktopStore()
    const editorInputStore = useEditorInputStore()
    const windowStore = useWindowStore()
    const editorNavigation = useEditorNavigation()

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
      updateStep: (id, params) =>
        menuModalsStore.updateStep(id, MenuModals.INSERT, params),
      setPending: (params) => menuModalsStore.setPendingModal(params),
      clearPending: (owner) =>
        menuModalsStore.clearPendingModal(owner ?? undefined),
      isPending: (owner) =>
        owner !== undefined && menuModalsStore.isPendingModal(owner),
      consumeBufferedIntent: menuModalsStore.consumeBufferedIntent,
      executeBufferedIntent: async (intent, result, sourceText) => {
        if (editorNavigation.isEditorPage()) {
          if (intent !== 'insert') return false
          if (
            editorNavigation.applyEditorTransfer(result, sourceText) === false
          )
            return true
          menuModalsStore.closeAll()
          editorInputStore.requestFocus()
          return true
        }
        if (intent === 'insert') {
          if (!desktopStore.canInsertIntoWindow) {
            toastKey('selection.noTarget', 'warn')
            return false
          }
          menuModalsStore.closeAll()
          await historyStore.saveOutput(result)
          const outcome = await invocations.call('core.insert', result)
          if (!outcome.ok) {
            toastText(toolResultMessage(outcome, translate), 'error')
          }
          return true
        }
        menuModalsStore.closeAll()
        await historyStore.saveOutput(result)
        const outcome = await invocations.call('core.copy', result)
        if (!outcome.ok) {
          toastText(toolResultMessage(outcome, translate), 'error')
          return true
        }
        toastKey('common.copied', 'success')
        if (isQuickWindow()) {
          await windowStore.hide()
        }
        return true
      },
      saveResult: async (text, result) => {
        try {
          const sourceId = await historyStore.saveSource(text, 'correction')
          await historyStore.saveSourceResult(sourceId, result)
        } catch {
          toastKey('history.operationFailed', 'error')
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
      schedulePrecorrection: corrector.schedulePrecorrection,
      /** Stops a correction made in advance; a finished one stays reusable. */
      cancelPrecorrection: corrector.cancel,
    }
  }
)
