import { clientLogger } from '../lib/logger'
import { onScopeDispose } from 'vue'
import { defineStore } from 'pinia'
import { createHistoryModel } from '../lib/history/history-model'
import { useIpcStore } from './ipc'

export const useHistoryStore = defineStore('history', () => {
  const ipcStore = useIpcStore()
  const model = createHistoryModel({ call: ipcStore.call }, (error) =>
    clientLogger.error('Could not refresh chat history', error, 'history')
  )
  onScopeDispose(model.dispose)
  return model
})
