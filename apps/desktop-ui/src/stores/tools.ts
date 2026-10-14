import { defineStore, getActivePinia } from 'pinia'

import type { LlmTask } from '@tyco/shared'

import { useLlmStore } from './llm'
import { useTranslationActions } from '../composables/use-translation-actions'
import { useDesktopInsertion } from '../composables/use-desktop-insertion'
import { executeWebhook } from '../lib/custom-actions/webhook-executor'
import { translate } from '../lib/i18n'
import { normalizeLlmConfig } from '../lib/llm/llm-config'
import { describeError } from '../lib/llm/llm-errors'
import { createTauriFetch } from '../lib/net/tauri-fetch'
import { tauriNetIpc } from '../lib/net/tauri-net'
import { createScriptAndWebhookTools } from '../lib/tools/script-and-webhook-tools'
import { createCoreTools } from '../lib/tools/core-tools'
import { createToolRegistry } from '../lib/tools/tool-registry'
import type { TranslationMeta } from '../lib/translation/translation-meta'
import { useChatStore } from './chat'
import { useTextCorrectionStore } from './text-correction'
import { createScriptActionClient } from '../lib/custom-actions/script-action-client'
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
  const { aiCustomPrompt } = useLlmStore().actions
  const { translateTo } = useTranslationActions()
  const textCorrectionStore = useTextCorrectionStore()
  const { pasteIntoTargetAndHide } = useDesktopInsertion()

  const getLlmUnavailableReasonKey = (task: LlmTask) =>
    normalizeLlmConfig(ipcStore.desktopState.userConfig?.llm).taskModelChains[
      task
    ]?.length
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
    correctText: textCorrectionStore.correct,
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
    getLlmUnavailableReasonKey,
    getTranslatorUnavailableReasonKey: () =>
      ipcStore.desktopState.userConfig?.translation?.provider === 'llm'
        ? getLlmUnavailableReasonKey('translate')
        : undefined,
    describeError: (error) => describeError(error, translate),
  })

  return createToolRegistry([
    ...createScriptAndWebhookTools({
      ...createScriptActionClient(ipcStore.callFunction),
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
