import { toolResultMessage } from '../lib/invocation/invocation-result'
import { createMenuStepRun } from '../lib/modals/menu-step-run'
import { useHistoryStore } from '../stores/history'
import { useMenuModalsStore } from '../stores/menu-modals'
import { useBufferedIntent } from './use-buffered-intent'
import { useI18n } from './use-i18n'
import useToast from './use-toast'

/** Runs a tool from a menu step; see `createMenuStepRun` */
export function useMenuStepRun() {
  const menuModalsStore = useMenuModalsStore()
  const historyStore = useHistoryStore()
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
    executeBufferedIntent: useBufferedIntent(),
  })
}
