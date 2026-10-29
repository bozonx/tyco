import { defineStore } from 'pinia'

import { TRANSLATION_SECRET_IDS, type LlmTask } from '@tyco/shared'

import { useLlmStore } from './llm'
import { executeWebhook } from '../lib/custom-actions/webhook-executor'
import { translate } from '../lib/i18n'
import { createDesktopInsertion } from '../lib/ipc/desktop-insertion'
import { resultOrThrow } from '../lib/ipc/ipc-model'
import { normalizeLlmConfig } from '../lib/llm/llm-config'
import { describeError } from '../lib/errors/describe-error'
import { isSecretUsable } from '../lib/net/secrets'
import { createTauriFetch } from '../lib/net/tauri-fetch'
import { tauriNetIpc } from '../lib/net/tauri-net'
import { createScriptAndWebhookTools } from '../lib/tools/script-and-webhook-tools'
import { createCoreTools } from '../lib/tools/core-tools'
import { createToolRegistry } from '../lib/tools/tool-registry'
import type { TranslationMeta } from '../lib/translation/translation-meta'
import { useSecretsStore } from './secrets'
import { useTextCorrectionStore } from './text-correction'
import { useTranslationStore } from './translation'
import { createScriptActionClient } from '../lib/custom-actions/script-action-client'
import { useDesktopStore } from './desktop'
import { useIpcStore } from './ipc'

/**
 * The tool registry of the window: the built-in tools of the app and those the
 * enabled plugins register
 */

export const useToolsStore = defineStore('tools', () => {
  const ipcStore = useIpcStore()
  const desktopStore = useDesktopStore()
  const secretsStore = useSecretsStore()
  const { aiCustomPrompt, transformationPrompt, stylingPrompt } =
    useLlmStore().actions
  const { translateTo } = useTranslationStore().actions
  const textCorrectionStore = useTextCorrectionStore()
  const { pasteIntoTargetAndHide } = createDesktopInsertion({
    pasteIntoTargetAndHide: (text) =>
      ipcStore.call('paste_into_target_and_hide', { text }),
    notifyDesktop: (summary, body) =>
      ipcStore.call('show_desktop_notification', { summary, body }),
    translateInsertFailed: () => translate('toast.insertFailed'),
  })

  const getLlmUnavailableReasonKey = (task: LlmTask) =>
    normalizeLlmConfig(desktopStore.userConfig?.llm).tasks[task].modelId
      ? undefined
      : 'tools.noLlm'

  // the chat hands itself in: the registry does not depend on it
  let askInChatHandler: ((text: string) => Promise<void>) | null = null
  /** Lets `core.askInChat` reach the chat; returns the release function */
  const provideAskInChat = (handler: (text: string) => Promise<void>) => {
    askInChatHandler = handler
    return () => {
      if (askInChatHandler === handler) askInChatHandler = null
    }
  }

  const coreTools = createCoreTools({
    insertText: pasteIntoTargetAndHide,
    copyText: async (text) => {
      resultOrThrow(await ipcStore.call('copy_text', { text }), 'copy_text')
    },
    askInChat: async (text) => {
      if (!askInChatHandler) throw new Error('The chat is not available')
      await askInChatHandler(text)
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
    transformationPrompt: (prompt, text, signal) =>
      transformationPrompt(prompt, text, { signal, notifyError: false }),
    stylingPrompt: (prompt, text, signal) =>
      stylingPrompt(prompt, text, { signal, notifyError: false }),
    getLlmUnavailableReasonKey,
    getTranslatorUnavailableReasonKey: () => {
      const provider = desktopStore.userConfig?.translation?.provider
      if (provider === 'llm') {
        return getLlmUnavailableReasonKey('translation')
      }
      if (provider === 'deepl') {
        return isSecretUsable(
          secretsStore.secrets,
          TRANSLATION_SECRET_IDS.deepl
        )
          ? undefined
          : 'tools.noApiKey'
      }
      if (provider === 'google') {
        return isSecretUsable(
          secretsStore.secrets,
          TRANSLATION_SECRET_IDS.google
        )
          ? undefined
          : 'tools.noApiKey'
      }
      return undefined
    },
    describeError: (error) => describeError(error, translate),
  })

  const registry = createToolRegistry([
    ...createScriptAndWebhookTools({
      ...createScriptActionClient(ipcStore.call),
      executeWebhook: (target, text, signal) =>
        executeWebhook(
          target,
          text,
          createTauriFetch(tauriNetIpc, 'webhook'),
          async (name, details) => {
            await ipcStore.call('log_webhook_call', { name, details })
          },
          signal
        ),
    }),
    ...coreTools,
  ])
  return { ...registry, provideAskInChat }
})
