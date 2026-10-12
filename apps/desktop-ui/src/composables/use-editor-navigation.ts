import { appNavigation } from '../lib/navigation/navigation'
import { APP_ROUTES } from '../lib/navigation/routes'
import { useEditorInputStore } from '../stores/editor-input'
import { useMenuModalsStore } from '../stores/menu-modals'
import { useIpcStore } from '../stores/ipc'
import { getDesktopWindow as getCurrentWindow } from '../lib/desktop/window'

export function useEditorNavigation() {
  const menuModalsStore = useMenuModalsStore()
  const editorInputStore = useEditorInputStore()
  const ipcStore = useIpcStore()

  /**
   * @param sourceText What `text` was transformed from; lets the result replace
   *   only the editor selection the transformation was started on
   */
  function applyEditorTransfer(text?: string, sourceText?: string) {
    if (typeof text !== 'undefined') {
      if (typeof sourceText === 'undefined') {
        editorInputStore.replaceValue(text)
      } else {
        editorInputStore.applyResult(text, sourceText)
      }
    }
  }

  function toEditor(text?: string, sourceText?: string) {
    menuModalsStore.closeAll()

    if (getCurrentWindow().label === 'quick') {
      void ipcStore.callFunctionOrNotify('openMainEditor', [text, sourceText])
      return
    }

    applyEditorTransfer(text, sourceText)
    void appNavigation.goToEditor()
  }

  function isEditorPage() {
    return appNavigation.isCurrent(APP_ROUTES.EDITOR.path)
  }

  return { applyEditorTransfer, toEditor, isEditorPage }
}
