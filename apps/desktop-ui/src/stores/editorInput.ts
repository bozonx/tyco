import { defineStore } from 'pinia'

import { createEditorInputStoreModel } from '../lib/editor-input/editor-input-store'
import { useHistoryStore } from './history'

export const useEditorInputStore = defineStore('editorInput', () => {
  const historyStore = useHistoryStore()

  return createEditorInputStoreModel({
    saveDraft: (text, replaceId) => historyStore.saveDraft(text, replaceId),
  })
})
