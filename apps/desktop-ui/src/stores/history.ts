import { clientLogger } from '../lib/logger'
import { onScopeDispose } from 'vue'
import { defineStore } from 'pinia'
import { createHistoryModel } from '../lib/history/history-model'
import { useIpcStore } from './ipc'
import { useDesktopStore } from './desktop'
import { isEditorHistoryOff } from '../lib/history/editor-history-storage'

export const useHistoryStore = defineStore('history', () => {
  const ipcStore = useIpcStore()
  const desktop = useDesktopStore()
  const model = createHistoryModel(
    { call: ipcStore.call },
    (error) =>
      clientLogger.error('Could not refresh chat history', error, 'history'),
    () => !isEditorHistoryOff(desktop.userConfig)
  )
  onScopeDispose(model.dispose)
  return model
})
