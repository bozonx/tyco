import { defineStore } from 'pinia'
import { onScopeDispose, watch } from 'vue'
import type { EditorHistoryOperation } from '@tyco/shared'

import { createQuickInputModel } from '../lib/quick-input/quick-input-model'
import { createInputHistorySession } from '../lib/history/input-history-session'
import { useHistoryStore } from './history'
import { useToastStore } from './toast'

export const useQuickInputStore = defineStore('quickInput', () => {
  const model = createQuickInputModel()
  const history = useHistoryStore()
  const toast = useToastStore()
  const session = createInputHistorySession({
    save: history.saveEditorHistory,
    reportError: () => toast.toastKey('history.operationFailed', 'error'),
  })
  watch(model.value, session.update, { flush: 'sync' })
  const unregister = history.registerInputFlush(async () => {
    await session.flush()
    return true
  })
  onScopeDispose(() => {
    unregister()
    session.dispose()
  })
  return {
    ...model,
    flushHistory: session.flush,
    saveSource: (text: string, operation: EditorHistoryOperation) =>
      session.complete(text, 'source', operation),
    rememberSubmitted: (text: string) => {
      session.end()
      model.rememberSubmitted(text)
    },
    clear: () => {
      session.end()
      model.clear()
    },
    discard: () => {
      session.end()
      model.discard()
    },
  }
})
