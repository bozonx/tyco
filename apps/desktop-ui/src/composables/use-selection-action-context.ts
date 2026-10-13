import { createSelectionActionContext } from '../lib/selection-replace/selection-action-context'
import { getDesktopWindowLabel } from '../lib/desktop/window'
import { useEditorInputStore } from '../stores/editor-input'
import { useIpcStore } from '../stores/ipc'
import { useMenuModalsStore } from '../stores/menu-modals'

export function useSelectionActionContext() {
  const ipc = useIpcStore()
  const editor = useEditorInputStore()
  const modals = useMenuModalsStore()
  return createSelectionActionContext({
    desktopSelectedText: () => ipc.desktopState?.selectedText,
    editorSelectedText: () => editor.selectedText,
    editorText: () => editor.value,
    isWindowShown: () => ipc.desktopState.isWindowShown,
    hasOpenModal: () => modals.anyModalOpen || Boolean(modals.pendingModal),
    canUseEditorText: () => getDesktopWindowLabel() !== 'quick',
  })
}
