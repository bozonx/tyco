import { defineStore } from 'pinia'

import { useHelpers } from '../composables/useHelpers'
import {
  MenuModals,
  createMenuModalsStoreModel,
} from '../lib/modals/menu-modals-store'

export { MenuModals }

export const useMenuModalsStore = defineStore('menuModals', () => {
  const { resetGlobalFocus } = useHelpers()
  return createMenuModalsStoreModel({ resetGlobalFocus })
})
