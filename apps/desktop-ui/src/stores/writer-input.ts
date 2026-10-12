import { defineStore } from 'pinia'

import { createDraftSession } from '../lib/history/draft-session'
import { createWriterInputModel } from '../lib/quick-input/writer-input-model'
import { useHistoryStore } from './history'

export const useWriterInputStore = defineStore('writerInput', () => {
  const history = useHistoryStore()
  return createWriterInputModel({
    drafts: createDraftSession(
      history.saveDraft,
      history.removeFromEditorHistory
    ),
  })
})
