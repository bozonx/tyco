import { createSelectionActionContext } from '../lib/selection-replace/selection-action-context'
import { isQuickWindow } from '../lib/desktop/window'
import { useEditorInputStore } from '../stores/editor-input'
import { useDesktopStore } from '../stores/desktop'
import { useMenuModalsStore } from '../stores/menu-modals'

export function useSelectionActionContext() {
  const desktopStore = useDesktopStore()
  const editor = useEditorInputStore()
  const modals = useMenuModalsStore()
  return createSelectionActionContext({
    desktopSelectedText: () => desktopStore.desktopState?.selectedText,
    editorSelectedText: () => editor.selectedText,
    editorText: () => editor.value,
    isWindowShown: () => desktopStore.desktopState.isWindowShown,
    hasOpenModal: () => modals.hasOpenModal || Boolean(modals.pendingModal),
    canUseEditorText: () => !isQuickWindow(),
  })
}
