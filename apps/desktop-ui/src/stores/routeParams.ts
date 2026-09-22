import { defineStore } from 'pinia'
import { ref } from 'vue'

import { appNavigation } from '../lib/navigation/navigation'
import { APP_ROUTES } from '../lib/navigation/routes'
import { useEditorInputStore } from './editorInput'
import { useMenuModalsStore } from './menuModals'
import { useIpcStore } from './ipc'
import { getCurrentWindow } from '@tauri-apps/api/window'

interface RouteParamsState {
  text?: string
}

export const useRouteParams = defineStore('routeParams', () => {
  const params = ref<RouteParamsState>({})
  const menuModalsStore = useMenuModalsStore()
  const editorInputStore = useEditorInputStore()
  const ipcStore = useIpcStore()

  function setParams(value: RouteParamsState) {
    params.value = value
  }

  /**
   * @param sourceText What `text` was transformed from; lets the result replace
   *   only the editor selection the transformation was started on
   */
  function applyEditorTransfer(text?: string, sourceText?: string) {
    if (typeof text !== 'undefined') {
      params.value = { text }

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
      void ipcStore.callFunction('openMainEditor', [text, sourceText])
      return
    }

    applyEditorTransfer(text, sourceText)
    void appNavigation.goToEditor()
  }

  function isEditorPage() {
    return appNavigation.isCurrent(APP_ROUTES.EDITOR.path)
  }

  return { params, setParams, applyEditorTransfer, toEditor, isEditorPage }
})
