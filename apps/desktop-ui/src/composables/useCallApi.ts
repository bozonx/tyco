import { translate } from '../lib/i18n'
import { useEditorInputStore } from '../stores/editorInput'
import { useIpcStore } from '../stores/ipc'
import useToast from './useToast'

export const useCallApi = () => {
  const ipcStore = useIpcStore()
  const editorInputStore = useEditorInputStore()
  const { toastText } = useToast()

  async function typeIntoWindowAndClose(text: string) {
    if (!text?.trim()) return

    const result = await ipcStore.callFunction('typeIntoWindowAndClose', [text])
    if (result.success) return

    const summary = translate('toast.insertFailed')
    const body = result.error || ''
    // the window may be hidden by now, where a toast would go unseen
    void ipcStore.callFunction('notifyDesktop', [summary, body])
    toastText(body ? `${summary}\n${body}` : summary, 'error')
  }

  function resolveText(text?: string): string {
    if (text) {
      return text
    }
    if (editorInputStore.selectedText) {
      return editorInputStore.selectedText
    }
    return editorInputStore.value || ''
  }

  return { resolveText, typeIntoWindowAndClose }
}
