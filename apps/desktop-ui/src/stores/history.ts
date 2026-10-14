import { defineStore } from 'pinia'
import { createHistoryModel } from '../lib/history/history-store'
import { useIpcStore } from './ipc'

export const useHistoryStore = defineStore('history', () => {
  const ipcStore = useIpcStore()

  return createHistoryModel({ callFunction: ipcStore.callFunction })
})
