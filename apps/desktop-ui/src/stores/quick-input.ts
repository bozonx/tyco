import { defineStore } from 'pinia'

import { createQuickInputModel } from '../lib/quick-input/quick-input-model'

export const useQuickInputStore = defineStore('quickInput', () =>
  createQuickInputModel()
)
