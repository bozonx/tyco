import { defineStore } from 'pinia'

import {
  type ToastItem,
  type ToastOptions,
  type ToastType,
  createToastStoreModel,
} from '../lib/toast/toast-store'

export type { ToastItem, ToastOptions, ToastType }

export const useToastStore = defineStore('toast', () => {
  return createToastStoreModel()
})
