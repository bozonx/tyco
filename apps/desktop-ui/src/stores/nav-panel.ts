import { defineStore } from 'pinia'
import { ref } from 'vue'

import { useMenuModalsStore } from './menu-modals'

export const DEFAULT_NAV_PANEL_STATE = {
  panelVisible: true,
  rightPanelVisible: true,
  escBtnText: undefined as string | undefined,
  escBtnLabelKey: 'nav.menu' as string | undefined,
  escBtnAction: undefined as (() => void) | undefined,
}

export const useNavPanelStore = defineStore('navPanel', () => {
  const params = ref({ ...DEFAULT_NAV_PANEL_STATE })
  const menuModalsStore = useMenuModalsStore()

  function resetNavParams(
    newParams: Partial<typeof DEFAULT_NAV_PANEL_STATE> = {}
  ) {
    params.value = { ...DEFAULT_NAV_PANEL_STATE, ...newParams }
  }

  function handleKeyUp(event: KeyboardEvent) {
    if (event.code !== 'Escape' || event.defaultPrevented) return

    if (menuModalsStore.anyModalOpen) {
      menuModalsStore.back()
    } else {
      params.value.escBtnAction?.()
    }
  }

  return { params, resetNavParams, handleKeyUp }
})
