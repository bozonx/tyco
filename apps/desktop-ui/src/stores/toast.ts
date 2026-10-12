import { defineStore } from 'pinia'
import { onScopeDispose } from 'vue'

import {
  type ToastItem,
  type ToastOptions,
  type ToastType,
  createToastStoreModel,
} from '../lib/toast/toast-store'

export type { ToastItem, ToastOptions, ToastType }

export const useToastStore = defineStore('toast', () => {
  const model = createToastStoreModel()
  onScopeDispose(model.clearToasts)
  return model
})
