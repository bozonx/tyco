import { defineStore } from 'pinia'
import { createHistoryStoreModel } from '../lib/history/history-store'
import { useIpcStore } from './ipc'

export const useHistoryStore = defineStore('history', () => {
  const ipcStore = useIpcStore()

  return createHistoryStoreModel({
    callFunction: (functionName, args = []) => ipcStore.callFunction(functionName, args),
  })
})
