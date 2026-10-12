import { defineStore } from 'pinia'
import { onScopeDispose } from 'vue'

import { useHelpers } from '../composables/use-helpers'
import {
  MenuModals,
  createMenuModalsStoreModel,
} from '../lib/modals/menu-modals-store'

export { MenuModals }

export const useMenuModalsStore = defineStore('menuModals', () => {
  const { resetGlobalFocus } = useHelpers()
  const model = createMenuModalsStoreModel({ resetGlobalFocus })
  onScopeDispose(model.cancelAndCloseAll)
  return model
})
