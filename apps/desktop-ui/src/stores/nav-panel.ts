import { defineStore } from 'pinia'
import { ref } from 'vue'

import { useMenuModalsStore } from './menu-modals'

export const DEFAULT_NAV_PANEL_STATE = {
  panelVisible: true,
  rightPanelVisible: true,
  escapeButtonText: undefined as string | undefined,
  escapeButtonLabelKey: 'nav.menu' as string | undefined,
  onEscape: undefined as (() => void) | undefined,
}

export const useNavPanelStore = defineStore('navPanel', () => {
  const navPanelState = ref({ ...DEFAULT_NAV_PANEL_STATE })
  const menuModalsStore = useMenuModalsStore()

  function resetNavPanelState(
    stateOverrides: Partial<typeof DEFAULT_NAV_PANEL_STATE> = {}
  ) {
    navPanelState.value = { ...DEFAULT_NAV_PANEL_STATE, ...stateOverrides }
  }

  function handleKeyUp(event: KeyboardEvent) {
    if (event.code !== 'Escape' || event.defaultPrevented) return

    if (menuModalsStore.hasOpenModal) {
      menuModalsStore.back()
    } else {
      navPanelState.value.onEscape?.()
    }
  }

  return { navPanelState, resetNavPanelState, handleKeyUp }
})
