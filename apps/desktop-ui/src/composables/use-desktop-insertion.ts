import { translate } from '../lib/i18n/index'
import { createDesktopInsertion } from '../lib/ipc/desktop-insertion'
import { useIpcStore } from '../stores/ipc'

export const useDesktopInsertion = () => {
  const ipcStore = useIpcStore()

  return createDesktopInsertion({
    pasteIntoTargetAndHide: (text) =>
      ipcStore.callFunction('pasteIntoTargetAndHide', [text]),
    notifyDesktop: (summary, body) =>
      ipcStore.callFunction('notifyDesktop', [summary, body]),
    translateInsertFailed: () => translate('toast.insertFailed'),
  })
}
