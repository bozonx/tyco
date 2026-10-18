import { ref } from 'vue'

export interface NavPanelState {
  panelVisible: boolean
  escapeButtonLabelKey: string
  onEscape: (() => void) | undefined
}

export const DEFAULT_NAV_PANEL_STATE: NavPanelState = {
  panelVisible: true,
  escapeButtonLabelKey: 'nav.menu',
  onEscape: undefined,
}

export interface NavPanelModelDependencies {
  hasOpenModal: () => boolean
  backModal: () => void
}

export function createNavPanelModel(deps: NavPanelModelDependencies) {
  const navPanelState = ref<NavPanelState>({ ...DEFAULT_NAV_PANEL_STATE })

  function resetNavPanelState(stateOverrides: Partial<NavPanelState> = {}) {
    navPanelState.value = { ...DEFAULT_NAV_PANEL_STATE, ...stateOverrides }
  }

  function handleKeyUp(
    event: Pick<KeyboardEvent, 'code' | 'defaultPrevented'>
  ) {
    if (event.code !== 'Escape' || event.defaultPrevented) return

    if (deps.hasOpenModal()) {
      deps.backModal()
    } else {
      navPanelState.value.onEscape?.()
    }
  }

  return { navPanelState, resetNavPanelState, handleKeyUp }
}
