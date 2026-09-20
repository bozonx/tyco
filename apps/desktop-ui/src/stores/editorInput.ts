import { defineStore } from 'pinia'
import { DebounceCallIncreasing } from '@/lib/squidlet-lib-local'

import { createEditorInputStoreModel } from '../lib/editor-input/editor-input-store'
import { useHistoryStore } from './history'

export const useEditorInputStore = defineStore('editorInput', () => {
  const debounced = new DebounceCallIncreasing()
  const historyStore = useHistoryStore()

  return createEditorInputStoreModel(historyStore, debounced)
})
