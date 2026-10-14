import { defineStore } from 'pinia'
import { onScopeDispose } from 'vue'

import { type ToastType, createToastModel } from '../lib/toast/toast-store'

export type { ToastType }

export const useToastStore = defineStore('toast', () => {
  const model = createToastModel()
  onScopeDispose(model.clearToasts)
  return model
})
