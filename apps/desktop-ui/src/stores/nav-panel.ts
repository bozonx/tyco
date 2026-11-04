import { defineStore } from 'pinia'

import { createNavPanelModel } from '../lib/nav-panel/nav-panel-model'
import { useIpcStore } from './ipc'
import { useMenuModalsStore } from './menu-modals'

export const useNavPanelStore = defineStore('navPanel', () => {
  const menuModalsStore = useMenuModalsStore()
  const ipcStore = useIpcStore()

  return createNavPanelModel({
    hasOpenModal: () => menuModalsStore.hasOpenModal,
    backModal: () => menuModalsStore.back(),
    closeAll: () => {
      menuModalsStore.cancelPending()
      menuModalsStore.closeAll()
      void ipcStore.callOrNotify('hide_window')
    },
  })
})
