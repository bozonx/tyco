import { defineStore } from 'pinia'

import { createDraftSession } from '../lib/history/draft-session'
import { createWriteInputModel } from '../lib/quick-input/write-input-model'
import { useHistoryStore } from './history'

export const useWriteInputStore = defineStore('writeInput', () => {
  const history = useHistoryStore()
  return createWriteInputModel({
    drafts: createDraftSession(
      history.saveDraft,
      history.removeFromEditorHistory
    ),
  })
})
