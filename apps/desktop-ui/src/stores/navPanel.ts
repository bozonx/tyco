import { defineStore } from 'pinia'
import { ref } from 'vue'

import { useMenuModalsStore } from './menuModals'

export const DEFAULT_PARAMS = {
  panelVisible: true,
  rightPanelVisible: true,
  escBtnText: undefined as string | undefined,
  escBtnLabelKey: 'nav.menu' as string | undefined,
  escBtnAction: undefined as (() => void) | undefined,
}

export const useNavPanelStore = defineStore('navPanel', () => {
  const params = ref(DEFAULT_PARAMS)
  const menuModalsStore = useMenuModalsStore()

  function upateNavParams(newParams: Partial<typeof DEFAULT_PARAMS>) {
    params.value = { ...params.value, ...newParams }
  }

  function resetNavParams(newParams: Partial<typeof DEFAULT_PARAMS> = {}) {
    params.value = { ...DEFAULT_PARAMS, ...newParams }
  }

  function handleKeyUp(event: KeyboardEvent) {
    if (event.code !== 'Escape') return

    if (menuModalsStore.anyModalOpen) {
      menuModalsStore.back()
    } else {
      params.value.escBtnAction?.()
    }
  }

  return {
    params,
    upateNavParams,
    resetNavParams,
    handleKeyUp,
  }
})
