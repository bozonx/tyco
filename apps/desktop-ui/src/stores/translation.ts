import { defineStore } from 'pinia'
import type { TranslationConfig } from '@tyco/shared'
import { markRaw } from 'vue'

import { translate } from '../lib/i18n'
import { normalizeLlmConfig } from '../lib/llm/llm-config'
import { taskModelLimits } from '../lib/llm/llm-limits'
import { clientLogger } from '../lib/logger'
import { createSecretKeyProvider } from '../lib/net/secrets'
import { createTauriTransport, tauriNetIpc } from '../lib/net/tauri-net'
import { createTranslationActions } from '../lib/translation/translation-actions'
import {
  createTranslationClient,
  translationKitSecretId,
} from '../lib/translation/translation-client'
import { normalizeTranslationConfig } from '../lib/translation/translation-config'
import { useDesktopStore } from './desktop'
import { useLlmStore } from './llm'
import { useSecretsStore } from './secrets'
import { useToastStore } from './toast'

/** The LLM tasks that translate */
type TranslationLlmTask = 'translation' | 'dialogTranslation'

export const useTranslationStore = defineStore('translation', () => {
  const desktopStore = useDesktopStore()
  const llmStore = useLlmStore()
  const secretsStore = useSecretsStore()
  const toast = useToastStore()
  /**
   * A client of the translation settings; `overrides` replaces some of them and
   * `task` is the LLM task that answers, e.g. for the dialog
   */
  const createClient = (
    options: {
      task?: TranslationLlmTask
      overrides?: Partial<TranslationConfig>
    } = {}
  ) => {
    const task = options.task ?? 'translation'
    return createTranslationClient({
      getConfig: () => ({
        ...normalizeTranslationConfig(desktopStore.userConfig?.translation),
        ...options.overrides,
      }),
      getLlmLimits: () =>
        taskModelLimits(normalizeLlmConfig(desktopStore.userConfig?.llm), task),
      transport: createTauriTransport(tauriNetIpc),
      keys: createSecretKeyProvider(
        () => secretsStore.client.status(),
        translationKitSecretId
      ),
      runLlm: (prompt, signal, runOptions = {}) =>
        llmStore.client.run(task, prompt, { signal, ...runOptions }),
    })
  }
  const client = createClient()
  const actions = createTranslationActions({
    client,
    getUserConfig: () => desktopStore.userConfig,
    translate,
    logError: (message, failure) =>
      clientLogger.error(message, failure, 'translation'),
    notifyError: (message) => toast.addToast(message, 'error'),
    notifyEmptyText: () =>
      toast.addToast(translate('toast.textNotSelected'), 'warn'),
  })

  return { client: markRaw(client), actions: markRaw(actions), createClient }
})
