import { defineStore } from 'pinia'
import { onScopeDispose } from 'vue'

import { blurActiveElement } from '../lib/ui/focus'
import {
  MenuModals,
  createMenuModalsModel,
} from '../lib/modals/menu-modals-store'

export { MenuModals }

export const useMenuModalsStore = defineStore('menuModals', () => {
  const model = createMenuModalsModel({ blurActiveElement })
  onScopeDispose(model.cancelAndCloseAll)
  return model
})
