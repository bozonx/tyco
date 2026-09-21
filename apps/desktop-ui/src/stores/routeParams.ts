import { defineStore } from 'pinia'
import { ref } from 'vue'

import { appNavigation } from '../lib/navigation/navigation'
import { APP_ROUTES } from '../lib/navigation/routes'
import { useEditorInputStore } from './editorInput'
import { useMenuModalsStore } from './menuModals'

interface RouteParamsState {
  text?: string
}

export const useRouteParams = defineStore('routeParams', () => {
  const params = ref<RouteParamsState>({})
  const menuModalsStore = useMenuModalsStore()
  const editorInputStore = useEditorInputStore()

  function setParams(value: RouteParamsState) {
    params.value = value
  }

  /**
   * @param sourceText What `text` was transformed from; lets the result replace
   *   only the editor selection the transformation was started on
   */
  function toEditor(text?: string, sourceText?: string) {
    if (typeof text !== 'undefined') {
      params.value = { text }

      if (typeof sourceText === 'undefined') {
        editorInputStore.replaceValue(text)
      } else {
        editorInputStore.applyResult(text, sourceText)
      }
    }
    menuModalsStore.closeAll()
    void appNavigation.goToEditor()
  }

  function isEditorPage() {
    return appNavigation.isCurrent(APP_ROUTES.EDITOR.path)
  }

  return { params, setParams, toEditor, isEditorPage }
})
