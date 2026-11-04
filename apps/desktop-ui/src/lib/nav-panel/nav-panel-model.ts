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
  closeAll?: () => void
}

export function createNavPanelModel(deps: NavPanelModelDependencies) {
  const navPanelState = ref<NavPanelState>({ ...DEFAULT_NAV_PANEL_STATE })

  function resetNavPanelState(stateOverrides: Partial<NavPanelState> = {}) {
    navPanelState.value = { ...DEFAULT_NAV_PANEL_STATE, ...stateOverrides }
  }

  function handleKeyDown(
    event: Pick<KeyboardEvent, 'code' | 'defaultPrevented'> & {
      shiftKey?: boolean
    }
  ) {
    if (event.code !== 'Escape' || event.defaultPrevented) return

    if (event.shiftKey) {
      if (deps.closeAll) {
        deps.closeAll()
      } else {
        deps.backModal()
      }
      return
    }

    if (deps.hasOpenModal()) {
      deps.backModal()
    } else {
      navPanelState.value.onEscape?.()
    }
  }

  return { navPanelState, resetNavPanelState, handleKeyDown }
}
