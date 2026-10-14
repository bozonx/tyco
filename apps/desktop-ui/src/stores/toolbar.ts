import { defineStore } from 'pinia'

import { createToolbarModel } from '../lib/toolbar/toolbar-store'

export const useToolbarStore = defineStore('toolbar', () => {
  return createToolbarModel()
})
