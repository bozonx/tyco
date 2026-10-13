import { appNavigation } from '../lib/navigation/navigation'
import { APP_ROUTES } from '../lib/navigation/routes'
import { useEditorInputStore } from '../stores/editor-input'
import { MenuModals, useMenuModalsStore } from '../stores/menu-modals'
import { useIpcStore } from '../stores/ipc'
import { getDesktopWindow as getCurrentWindow } from '../lib/desktop/window'
import useToast from './use-toast'

export function useEditorNavigation() {
  const menuModalsStore = useMenuModalsStore()
  const editorInputStore = useEditorInputStore()
  const ipcStore = useIpcStore()
  const { toast } = useToast()

  function reviewEditorTransfer(text: string) {
    let snapshot = editorInputStore.getSnapshot()
    const stepId = menuModalsStore.nextModal(MenuModals.DIFF, {
      oldText: snapshot.value,
      newText: text,
      replaceEditor: () => {
        if (!editorInputStore.applySnapshotEdit(snapshot, text, 'document')) {
          toast('toast.textTransformStale', 'warn')
          snapshot = editorInputStore.getSnapshot()
          menuModalsStore.updateStep(stepId, MenuModals.DIFF, {
            oldText: snapshot.value,
          })
          return
        }
        menuModalsStore.closeAll()
        editorInputStore.focus()
        void appNavigation.goToEditor()
      },
    })
  }

  /**
   * @param sourceText What `text` was transformed from; lets the result replace
   *   only the editor selection the transformation was started on
   */
  function applyEditorTransfer(text?: string, sourceText?: string) {
    if (typeof text !== 'undefined') {
      if (typeof sourceText === 'undefined') {
        editorInputStore.replaceValue(text)
      } else {
        if (!editorInputStore.applyResult(text, sourceText)) {
          toast('toast.textTransformStale', 'warn')
          reviewEditorTransfer(text)
          return false
        }
      }
    }
    return true
  }

  function toEditor(text?: string, sourceText?: string) {
    if (getCurrentWindow().label === 'quick') {
      menuModalsStore.closeAll()
      void ipcStore.callFunctionOrNotify('openMainEditor', [text, sourceText])
      return
    }

    if (!applyEditorTransfer(text, sourceText)) return
    menuModalsStore.closeAll()
    void appNavigation.goToEditor()
  }

  function isEditorPage() {
    return appNavigation.isCurrent(APP_ROUTES.EDITOR.path)
  }

  return { applyEditorTransfer, toEditor, isEditorPage }
}
