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

  function toEditor(text?: string) {
    if (typeof text !== 'undefined') {
      params.value = { text }
      editorInputStore.setValue(text)
    }
    menuModalsStore.closeAll()
    void appNavigation.goToEditor()
  }

  function isEditorPage() {
    return appNavigation.isCurrent(APP_ROUTES.EDITOR.path)
  }

  return {
    params,
    setParams,
    toEditor,
    isEditorPage,
  }
})
