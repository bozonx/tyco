import { defineStore } from 'pinia'

import { createWriteInputModel } from '../lib/quick-input/write-input-model'

export const useWriteInputStore = defineStore('writeInput', () =>
  createWriteInputModel()
)
