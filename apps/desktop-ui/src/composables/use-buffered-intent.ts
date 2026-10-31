import { isQuickWindow } from '../lib/desktop/window'
import { translate } from '../lib/i18n'
import { toolResultMessage } from '../lib/invocation/invocation-result'
import { createBufferedIntentRunner } from '../lib/modals/buffered-intent'
import { useDesktopStore } from '../stores/desktop'
import { useEditorInputStore } from '../stores/editor-input'
import { useHistoryStore } from '../stores/history'
import { useInvocationsStore } from '../stores/invocations'
import { useMenuModalsStore } from '../stores/menu-modals'
import { useToastStore } from '../stores/toast'
import { useWindowStore } from '../stores/window'
import { useEditorNavigation } from './use-editor-navigation'

/**
 * Runs an action buffered during a pending result; see
 * `createBufferedIntentRunner`
 */
export function useBufferedIntent() {
  const menuModalsStore = useMenuModalsStore()
  const historyStore = useHistoryStore()
  const desktopStore = useDesktopStore()
  const invocations = useInvocationsStore()
  const editorNavigation = useEditorNavigation()
  const editorInputStore = useEditorInputStore()
  const windowStore = useWindowStore()
  const { toastKey, toastText } = useToastStore()

  return createBufferedIntentRunner({
    isEditorPage: editorNavigation.isEditorPage,
    applyEditorTransfer: editorNavigation.applyEditorTransfer,
    focusEditor: () => editorInputStore.requestFocus(),
    canInsertIntoWindow: () => desktopStore.canInsertIntoWindow,
    closeAll: () => menuModalsStore.closeAll(),
    saveOutput: historyStore.saveOutput,
    insert: (text) => invocations.call('core.insert', text),
    copy: (text) => invocations.call('core.copy', text),
    isQuickWindow,
    hideWindow: () => windowStore.hide(),
    notifyNoTarget: () => toastKey('selection.noTarget', 'warn'),
    notifyCopied: () => toastKey('common.copied', 'success'),
    reportHistoryError: () => toastKey('history.operationFailed', 'error'),
    reportFailure: (result) =>
      toastText(toolResultMessage(result, translate), 'error'),
  })
}
