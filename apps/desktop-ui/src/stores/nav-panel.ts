import { defineStore } from 'pinia'

import {
  createNavPanelModel,
  DEFAULT_NAV_PANEL_STATE,
} from '../lib/nav-panel/nav-panel-model'
import { useMenuModalsStore } from './menu-modals'

export { DEFAULT_NAV_PANEL_STATE }

export const useNavPanelStore = defineStore('navPanel', () => {
  const menuModalsStore = useMenuModalsStore()

  return createNavPanelModel({
    hasOpenModal: () => menuModalsStore.hasOpenModal,
    backModal: () => menuModalsStore.back(),
  })
})
