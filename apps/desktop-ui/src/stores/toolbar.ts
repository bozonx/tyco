import { defineStore } from 'pinia'

import { createToolbarModel } from '../lib/toolbar/toolbar-model'

export const useToolbarStore = defineStore('toolbar', () => {
  return createToolbarModel()
})
