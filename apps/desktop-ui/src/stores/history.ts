import { clientLogger } from '../lib/logger'
import { defineStore } from 'pinia'
import { createHistoryModel } from '../lib/history/history-model'
import { useIpcStore } from './ipc'

export const useHistoryStore = defineStore('history', () => {
  const ipcStore = useIpcStore()

  return createHistoryModel({ call: ipcStore.call }, (error) =>
    clientLogger.error('Could not refresh chat history', error, 'history')
  )
})
