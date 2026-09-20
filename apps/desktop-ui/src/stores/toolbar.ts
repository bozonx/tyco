import { defineStore } from 'pinia'

import { createToolbarStoreModel } from '../lib/toolbar/toolbar-store'

export const useToolbarStore = defineStore('toolbar', () => {
  return createToolbarStoreModel()
})
