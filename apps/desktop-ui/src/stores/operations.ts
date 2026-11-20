import { defineStore } from 'pinia'

import { APP_CONFIG, TRANSLATION_SECRET_IDS, type LlmTask } from '@tyco/shared'

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
import { createScriptAndWebhookOperations } from '../lib/operations/script-and-webhook-operations'
import { createAiCommandOperation } from '../lib/ai-commands/ai-command-operation'
import { createCommandTransformer } from '../lib/commands/command-runner'
import { invocationUnavailableReason } from '../lib/invocation/invoke-operation'
import { createCoreOperations } from '../lib/operations/core-operations'
import { commandInputSchema } from '../lib/operations/command-parameters'
import { createOperationRegistry } from '../lib/operations/operation-registry'
import type { TranslationMeta } from '../lib/translation/translation-meta'
import { useSecretsStore } from './secrets'
import { useTextCorrectionStore } from './text-correction'
import { useTranslationStore } from './translation'
import { createScriptActionClient } from '../lib/custom-actions/script-action-client'
import { useDesktopStore } from './desktop'
import {
  deviceVariableValues,
  type CommandEnvironment,
} from '../lib/variables/command-variables'
import { useIpcStore } from './ipc'

/**
 * The tool registry of the window: the built-in tools of the app and those the
 * enabled plugins register
 */

export const useOperationsStore = defineStore('tools', () => {
  const ipcStore = useIpcStore()
  const desktopStore = useDesktopStore()
  const secretsStore = useSecretsStore()
  const llmStore = useLlmStore()
  const { transformationPrompt, stylingPrompt } = llmStore.actions
  const { translateTo } = useTranslationStore().actions
  const textCorrectionStore = useTextCorrectionStore()
  const { pasteIntoTargetAndHide } = createDesktopInsertion({
    pasteIntoTargetAndHide: (text) =>
      ipcStore.call('paste_into_target_and_hide', { text }),
    notifyDesktop: (summary, body) =>
      ipcStore.call('show_desktop_notification', { summary, body }),
    translateInsertFailed: () => translate('toast.insertFailed'),
  })

  /** The platform and the variable values of this device */
  const environment = (): CommandEnvironment => ({
    platform: desktopStore.userData?.platform ?? '',
    variables: deviceVariableValues(
      desktopStore.userConfig,
      desktopStore.userData
    ),
  })

  const getLlmUnavailableReasonKey = (task: LlmTask) =>
    normalizeLlmConfig(desktopStore.userConfig?.llm).tasks[task].modelId
      ? undefined
      : 'operations.noLlm'

  // the chat hands itself in: the registry does not depend on it
  let askInChatHandler: ((text: string) => Promise<void>) | null = null
  /** Lets `core.askInChat` reach the chat; returns the release function */
  const provideAskInChat = (handler: (text: string) => Promise<void>) => {
    askInChatHandler = handler
    return () => {
      if (askInChatHandler === handler) askInChatHandler = null
    }
  }

  const coreOperations = createCoreOperations({
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
          : 'operations.noApiKey'
      }
      if (provider === 'google') {
        return isSecretUsable(
          secretsStore.secrets,
          TRANSLATION_SECRET_IDS.google
        )
          ? undefined
          : 'operations.noApiKey'
      }
      return undefined
    },
    describeError: (error) => describeError(error, translate),
  })

  // the agent runs commands through the registry it is a tool of
  const transformCommand = createCommandTransformer({
    operations: { get: (id) => registry.get(id), environment },
  })
  const aiCommandOperation = createAiCommandOperation({
    stream: (task, prompt, options) =>
      llmStore.client.stream(task, prompt, options),
    instructions: () => APP_CONFIG.aiInstructions.aiTask,
    commands: () => desktopStore.userConfig?.commands ?? [],
    commandInputSchema: (command) => {
      const tool = registry.get(command.operationId)
      if (
        !tool ||
        invocationUnavailableReason(
          command,
          { get: registry.get, environment },
          // the agent gives the input whole, a structured one too
          { hasExplicitInput: true }
        )
      )
        return undefined
      return commandInputSchema(tool, command.operationConfig)
    },
    runCommand: (command, input, options) =>
      transformCommand(
        command,
        typeof input.text === 'string' ? input.text : '',
        { ...options, input, output: 'return' }
      ),
    getUnavailableReasonKey: () => getLlmUnavailableReasonKey('aiTask'),
    describeError: (error) => describeError(error, translate),
    variables: () => environment().variables,
  })

  const registry = createOperationRegistry([
    ...createScriptAndWebhookOperations({
      ...createScriptActionClient(ipcStore.call),
      secretIds: async () =>
        new Set(Object.keys(await useSecretsStore().client.status())),
      executeWebhook: (target, text, signal, selectionText) =>
        executeWebhook(
          target,
          text,
          createTauriFetch(tauriNetIpc, 'webhook'),
          async (name, details) => {
            await ipcStore.call('log_webhook_call', { name, details })
          },
          signal,
          environment().variables,
          selectionText
        ),
    }),
    ...coreOperations,
    aiCommandOperation,
  ])
  return { ...registry, environment, provideAskInChat }
})
