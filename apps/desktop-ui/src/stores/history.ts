import { defineStore } from 'pinia'
import { createHistoryModel } from '../lib/history/history-model'
import { useIpcStore } from './ipc'

export const useHistoryStore = defineStore('history', () => {
  const ipcStore = useIpcStore()

  return createHistoryModel({ call: ipcStore.call })
})
