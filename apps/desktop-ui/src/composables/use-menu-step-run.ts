import { toolResultMessage } from '../lib/invocation/invocation-result'
import { createMenuStepRun } from '../lib/modals/menu-step-run'
import { useDesktopStore } from '../stores/desktop'
import { useHistoryStore } from '../stores/history'
import { useInvocationsStore } from '../stores/invocations'
import { useMenuModalsStore } from '../stores/menu-modals'
import { useI18n } from './use-i18n'
import useToast from './use-toast'

/** Runs a tool from a menu step; see `createMenuStepRun` */
export function useMenuStepRun() {
  const menuModalsStore = useMenuModalsStore()
  const historyStore = useHistoryStore()
  const desktopStore = useDesktopStore()
  const invocationsStore = useInvocationsStore()
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
    executeBufferedIntent: async (intent, text) => {
      menuModalsStore.closeAll()
      if (intent === 'insert' && desktopStore.canInsertIntoWindow) {
        await invocationsStore.call('core.insert', text)
      } else {
        await invocationsStore.call('core.copy', text)
      }
    },
  })
}
