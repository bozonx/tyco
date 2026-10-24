import { clientLogger } from '../lib/logger'
import { defineStore } from 'pinia'
import { createHistoryModel } from '../lib/history/history-model'
import { useDesktopStore } from './desktop'
import { useIpcStore } from './ipc'

export const useHistoryStore = defineStore('history', () => {
  const ipcStore = useIpcStore()

  const desktopStore = useDesktopStore()
  return createHistoryModel(
    { call: ipcStore.call },
    (error) =>
      clientLogger.error('Could not refresh chat history', error, 'history'),
    () => desktopStore.userConfig.isInDevelopment === true
  )
})
