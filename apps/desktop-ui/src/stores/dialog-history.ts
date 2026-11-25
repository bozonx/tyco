import { DESKTOP_EVENTS } from '@tyco/shared'
import { defineStore } from 'pinia'
import { onScopeDispose } from 'vue'

import { desktopClient } from '../lib/desktop/client'
import { createDialogHistoryModel } from '../lib/dialog/dialog-history-model'
import {
  createIpcDialogStorageDriver,
  isDialogHistoryEnabled,
} from '../lib/dialog/dialog-history-storage'
import { clientLogger } from '../lib/logger'
import { useDesktopStore } from './desktop'
import { useIpcStore } from './ipc'

export const useDialogHistoryStore = defineStore('dialog-history', () => {
  const ipcStore = useIpcStore()
  const desktopStore = useDesktopStore()

  const model = createDialogHistoryModel({
    storage: createIpcDialogStorageDriver({ call: ipcStore.call }),
    isHistoryEnabled: () => isDialogHistoryEnabled(desktopStore.userConfig),
    reportError: (error) =>
      clientLogger.warn(
        `A dialog history operation failed: ${String(error)}`,
        'dialog'
      ),
  })

  const refresh = () => {
    void model.loadDialogs().catch((error: unknown) => {
      clientLogger.warn(
        `Could not refresh dialog history: ${String(error)}`,
        'dialog'
      )
    })
  }

  let unlistenDialogs: (() => void) | undefined
  let unlistenStorage: (() => void) | undefined
  let isDisposed = false

  void desktopClient
    .listen(DESKTOP_EVENTS.DIALOGS_CHANGED, () => {
      refresh()
    })
    .then((unlisten) => {
      if (isDisposed) unlisten()
      else unlistenDialogs = unlisten
    })
    .catch(() => undefined)

  void desktopClient
    .listen(DESKTOP_EVENTS.STORAGE_CHANGED, (event) => {
      if (event.paths.some((path) => path.startsWith('dialogs/'))) refresh()
    })
    .then((unlisten) => {
      if (isDisposed) unlisten()
      else unlistenStorage = unlisten
    })
    .catch(() => undefined)

  onScopeDispose(() => {
    isDisposed = true
    unlistenDialogs?.()
    unlistenStorage?.()
    void model.dispose()
  })

  return model
})
