import { isQuickWindow } from '../lib/desktop/window'
import { toolResultMessage } from '../lib/invocation/invocation-result'
import { createMenuStepRun } from '../lib/modals/menu-step-run'
import { useDesktopStore } from '../stores/desktop'
import { useEditorInputStore } from '../stores/editor-input'
import { useHistoryStore } from '../stores/history'
import { useInvocationsStore } from '../stores/invocations'
import { useMenuModalsStore } from '../stores/menu-modals'
import { useWindowStore } from '../stores/window'
import { useEditorNavigation } from './use-editor-navigation'
import { useI18n } from './use-i18n'
import useToast from './use-toast'

/** Runs a tool from a menu step; see `createMenuStepRun` */
export function useMenuStepRun() {
  const menuModalsStore = useMenuModalsStore()
  const historyStore = useHistoryStore()
  const desktopStore = useDesktopStore()
  const invocationsStore = useInvocationsStore()
  const editorNavigation = useEditorNavigation()
  const editorInputStore = useEditorInputStore()
  const windowStore = useWindowStore()
  const { toastKey, toastText } = useToast()
  const { t } = useI18n()

  return createMenuStepRun({
    currentStepId: () => menuModalsStore.currentStepId,
    hasStep: menuModalsStore.hasStep,
    setPending: menuModalsStore.setPendingModal,
    clearPending: menuModalsStore.clearPendingModal,
    saveSource: historyStore.saveSource,
    saveSourceResult: historyStore.saveSourceResult,
    reportHistoryError: () => toastKey('history.operationFailed', 'error'),
    describeResult: (result) => toolResultMessage(result, t),
    reportError: (message) => toastText(message, 'error'),
    consumeBufferedIntent: menuModalsStore.consumeBufferedIntent,
    executeBufferedIntent: async (intent, text, sourceText) => {
      if (intent === 'insert' && editorNavigation.isEditorPage()) {
        if (editorNavigation.applyEditorTransfer(text, sourceText) === false)
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
        await historyStore.saveOutput(text)
        const outcome = await invocationsStore.call('core.insert', text)
        if (!outcome.ok) {
          toastText(toolResultMessage(outcome, t), 'error')
        }
        return true
      }
      menuModalsStore.closeAll()
      await historyStore.saveOutput(text)
      const outcome = await invocationsStore.call('core.copy', text)
      if (!outcome.ok) {
        toastText(toolResultMessage(outcome, t), 'error')
        return true
      }
      toastKey('common.copied', 'success')
      if (isQuickWindow()) {
        await windowStore.hide()
      }
      return true
    },
  })
}
