import { defineStore } from 'pinia'

import type { LlmTask } from '@tyco/shared'

import { useCallAi } from '../composables/useCallAi'
import { useCallApi } from '../composables/useCallApi'
import { executeWebhook } from '../lib/custom-actions/webhook-executor'
import { translate } from '../lib/i18n'
import { LlmError } from '../lib/llm/llm-client'
import { normalizeLlmConfig } from '../lib/llm/llm-config'
import { formatLlmError } from '../lib/llm/llm-errors'
import { createTauriFetch } from '../lib/net/tauri-fetch'
import { tauriNetIpc } from '../lib/net/tauri-net'
import { createBuiltinTools } from '../lib/tools/builtin-tools'
import { createCoreTools } from '../lib/tools/core-tools'
import { createToolCatalogSync } from '../lib/tools/tool-catalog'
import { createToolRegistry } from '../lib/tools/tool-registry'
import { useChatStore } from './chat'
import { useIpcStore } from './ipc'

/**
 * The tool registry of the window: the built-in tools of the app and those the
 * enabled plugins register
 */
function describeError(error: unknown): string {
  if (error instanceof LlmError) return formatLlmError(error, translate)
  return error instanceof Error ? error.message : String(error)
}

export const useToolsStore = defineStore('tools', () => {
  const ipcStore = useIpcStore()
  const { correctText, translateTo, aiCustomPrompt } = useCallAi()
  const { typeIntoWindowAndClose } = useCallApi()

  const llmUnavailable = (task: LlmTask) =>
    normalizeLlmConfig(ipcStore.params.userConfig?.llm).tasks[task]?.length
      ? undefined
      : 'tools.noLlm'

  const coreTools = createCoreTools({
    insertText: typeIntoWindowAndClose,
    copyText: async (text) => {
      const result = await ipcStore.callFunction('copyText', [text])
      if (!result.success) throw new Error(result.error ?? 'copyText')
    },
    askInChat: async (text) => {
      await useChatStore().attachToChat(text)
    },
    correctText: (text, signal) =>
      correctText(text, { signal, notifyError: false }),
    translateTo: (language, text, signal) =>
      translateTo(language, text, { signal, notifyError: false }).then(
        (result) => (result ? result.text : '')
      ),
    aiCustomPrompt: (prompt, text, signal) =>
      aiCustomPrompt(prompt, text, { signal, notifyError: false }),
    llmUnavailable,
    translatorUnavailable: () =>
      ipcStore.params.userConfig?.translation?.provider === 'llm'
        ? llmUnavailable('translate')
        : undefined,
    describeError,
  })

  return createToolRegistry([
    ...createBuiltinTools({
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
    }),
    ...coreTools,
  ])
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
