import { defineStore, getActivePinia } from 'pinia'

import type { LlmTask } from '@tyco/shared'

import { useLlmActions } from '../composables/use-llm-actions'
import { useTranslationActions } from '../composables/use-translation-actions'
import { useDesktopInsertion } from '../composables/use-desktop-insertion'
import { executeWebhook } from '../lib/custom-actions/webhook-executor'
import { translate } from '../lib/i18n'
import { normalizeLlmConfig } from '../lib/llm/llm-config'
import { describeError } from '../lib/llm/llm-errors'
import { createTauriFetch } from '../lib/net/tauri-fetch'
import { tauriNetIpc } from '../lib/net/tauri-net'
import { createBuiltinTools } from '../lib/tools/builtin-tools'
import { createCoreTools } from '../lib/tools/core-tools'
import { createToolRegistry } from '../lib/tools/tool-registry'
import type { TranslationMeta } from '../lib/translation/translation-meta'
import { useChatStore } from './chat'
import { useCorrectorStore } from './corrector'
import { useIpcStore } from './ipc'
import { useMenuModalsStore } from './menu-modals'

/**
 * The tool registry of the window: the built-in tools of the app and those the
 * enabled plugins register
 */

export const useToolsStore = defineStore('tools', () => {
  const pinia = getActivePinia()
  const menuModalsStore = useMenuModalsStore()
  const ipcStore = useIpcStore()
  const { aiCustomPrompt } = useLlmActions()
  const { translateTo } = useTranslationActions()
  const correctorStore = useCorrectorStore()
  const { pasteIntoTargetAndHide } = useDesktopInsertion()

  const llmUnavailable = (task: LlmTask) =>
    normalizeLlmConfig(ipcStore.params.userConfig?.llm).tasks[task]?.length
      ? undefined
      : 'tools.noLlm'

  const coreTools = createCoreTools({
    insertText: pasteIntoTargetAndHide,
    copyText: async (text) => {
      const result = await ipcStore.callFunction('copyText', [text])
      if (!result.success) throw new Error(result.error ?? 'copyText')
    },
    askInChat: async (text) => {
      // the chat takes the place of whatever step the menu was on
      menuModalsStore.closeAll()
      await useChatStore(pinia).attachToChat(text)
    },
    correctText: correctorStore.correct,
    translateTo: async (language, text, options) => {
      const result = await translateTo(language, text, {
        ...options,
        notifyError: false,
      })
      if (!result) return { text: '' }
      const { text: translated, provider, kind, model, quality } = result
      return {
        text: translated,
        meta: { provider, kind, model, quality } satisfies TranslationMeta,
      }
    },
    aiCustomPrompt: (prompt, text, signal) =>
      aiCustomPrompt(prompt, text, { signal, notifyError: false }),
    llmUnavailable,
    translatorUnavailable: () =>
      ipcStore.params.userConfig?.translation?.provider === 'llm'
        ? llmUnavailable('translate')
        : undefined,
    describeError: (error) => describeError(error, translate),
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
      cancelScriptAction: async (runId) => {
        const result = await ipcStore.callFunction('cancelScriptAction', [
          runId,
        ])
        return result.success && result.result === true
      },
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
