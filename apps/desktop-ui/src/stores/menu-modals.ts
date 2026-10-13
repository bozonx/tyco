import { defineStore } from 'pinia'
import { onScopeDispose } from 'vue'

import { blurActiveElement } from '../lib/ui/focus'
import {
  MenuModals,
  createMenuModalsStoreModel,
} from '../lib/modals/menu-modals-store'

export { MenuModals }

export const useMenuModalsStore = defineStore('menuModals', () => {
  const model = createMenuModalsStoreModel({ blurActiveElement })
  onScopeDispose(model.cancelAndCloseAll)
  return model
})
