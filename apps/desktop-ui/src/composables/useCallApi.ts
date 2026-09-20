import { useEditorInputStore } from '../stores/editorInput'
import { useIpcStore } from '../stores/ipc'

export const useCallApi = () => {
  const ipcStore = useIpcStore()
  const editorInputStore = useEditorInputStore()

  // async function closeWindow() {
  //   await ipcStore.callFunction("closeMainWindow", []);
  // }

  async function typeIntoWindowAndClose(text: string) {
    if (!text?.trim()) return

    await ipcStore.callFunction('typeIntoWindowAndClose', [
      text,
      // ipcStore.params?.windowId,
    ])
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
