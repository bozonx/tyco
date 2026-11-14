import { defineStore } from 'pinia'
import { onScopeDispose } from 'vue'

import { createOperationCatalogSync } from '../lib/operations/operation-catalog'
import { clientLogger } from '../lib/logger'
import { translate } from '../lib/i18n'
import { resultOrThrow } from '../lib/ipc/ipc-model'
import { useDesktopStore } from './desktop'
import { useIpcStore } from './ipc'
import { useOperationsStore } from './operations'

/**
 * Sends the tools to the backend for external calls; started in the quick
 * window, which always exists, once the plugins have loaded
 */
export const useOperationCatalogStore = defineStore('operationCatalog', () => {
  const ipcStore = useIpcStore()
  const operationsStore = useOperationsStore()
  const desktopStore = useDesktopStore()

  const model = createOperationCatalogSync({
    tools: () => operationsStore.list(),
    commands: () => desktopStore.userConfig.commands,
    t: (key) => translate(key),
    send: async (catalog) => {
      resultOrThrow(
        await ipcStore.call('set_operation_catalog', { tools: catalog }),
        'Tool catalog sync failed'
      )
    },
    reportError: (error) =>
      clientLogger.error('Tool catalog sync failed', error),
  })
  onScopeDispose(model.dispose)
  return model
})
