import { translate } from '../lib/i18n/index'
import { useIpcStore } from '../stores/ipc'

export const useDesktopInsertion = () => {
  const ipcStore = useIpcStore()

  async function pasteIntoTargetAndHide(text: string) {
    if (!text?.trim()) return

    const result = await ipcStore.callFunction('pasteIntoTargetAndHide', [text])
    if (result.success) return

    const summary = translate('toast.insertFailed')
    const body = result.error || ''
    // the window may be hidden by now, where a toast would go unseen
    void ipcStore.callFunction('notifyDesktop', [summary, body])
    throw new Error(body ? `${summary}: ${body}` : summary)
  }

  return { pasteIntoTargetAndHide }
}
