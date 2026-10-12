import { defineStore } from 'pinia'
import { onScopeDispose } from 'vue'

import { createToolCatalogSync } from '../lib/tools/tool-catalog'
import { translate } from '../lib/i18n'
import { useIpcStore } from './ipc'
import { useToolsStore } from './tools'

/**
 * Sends the tools to the backend for external calls; started in the quick
 * window, which always exists, once the plugins have loaded
 */
export const useToolCatalogStore = defineStore('toolCatalog', () => {
  const ipcStore = useIpcStore()
  const toolsStore = useToolsStore()

  const model = createToolCatalogSync({
    tools: () => toolsStore.list(),
    t: (key) => translate(key),
    send: (catalog) => ipcStore.callFunction('setToolCatalog', [catalog]),
  })
  onScopeDispose(model.dispose)
  return model
})
