import { defineStore } from 'pinia'

import { executeWebhook } from '../lib/custom-actions/webhook-executor'
import { translate } from '../lib/i18n'
import { createTauriFetch } from '../lib/net/tauri-fetch'
import { tauriNetIpc } from '../lib/net/tauri-net'
import { createBuiltinTools } from '../lib/tools/builtin-tools'
import { createToolCatalogSync } from '../lib/tools/tool-catalog'
import { createToolRegistry } from '../lib/tools/tool-registry'
import { useIpcStore } from './ipc'

/**
 * The tool registry of the window: the built-in tools of the app and those the
 * enabled plugins register
 */
export const useToolsStore = defineStore('tools', () => {
  const ipcStore = useIpcStore()

  return createToolRegistry(
    createBuiltinTools({
      executeScriptAction: async (request) => {
        const res = await ipcStore.callFunction('executeScriptAction', [
          request,
        ])
        if (!res.success || !res.result) {
          throw new Error(res.error ?? 'Empty response')
        }
        return res.result
      },
      cancelScriptAction: (runId) =>
        ipcStore.callFunction('cancelScriptAction', [runId]),
      executeWebhook: (target, text, signal) =>
        executeWebhook(
          target,
          text,
          createTauriFetch(tauriNetIpc),
          async (name, type, details) => {
            await ipcStore.callFunction('logCustomAction', [
              name,
              type,
              details,
            ])
          },
          signal
        ),
    })
  )
})

/**
 * Sends the tools to the backend for external calls; started in the quick
 * window, which always exists, once the plugins have loaded
 */
export const useToolCatalogStore = defineStore('toolCatalog', () => {
  const ipcStore = useIpcStore()
  const toolsStore = useToolsStore()

  return createToolCatalogSync({
    tools: () => toolsStore.list(),
    t: (key) => translate(key),
    send: (catalog) => ipcStore.callFunction('setToolCatalog', [catalog]),
  })
})
