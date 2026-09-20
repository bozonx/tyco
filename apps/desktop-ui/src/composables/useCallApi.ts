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
    let value = ''

    if (text) {
      value = text
    } else if (editorInputStore.selectedText) {
      value = editorInputStore.selectedText
    } else {
      value = editorInputStore.value
    }

    return value || ''
  }

  return {
    resolveText,
    typeIntoWindowAndClose,
  }
}
