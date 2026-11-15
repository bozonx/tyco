import { defineStore } from 'pinia'

import { createNavPanelModel } from '../lib/nav-panel/nav-panel-model'
import { useMenuModalsStore } from './menu-modals'

export const useNavPanelStore = defineStore('navPanel', () => {
  const menuModalsStore = useMenuModalsStore()

  return createNavPanelModel({
    hasOpenModal: () => menuModalsStore.hasOpenModal,
    backModal: () => menuModalsStore.back(),
  })
})
