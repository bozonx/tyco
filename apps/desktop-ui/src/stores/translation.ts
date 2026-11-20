import { defineStore } from 'pinia'
import type { TranslationProvider } from '@tyco/shared'
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

export const useTranslationStore = defineStore('translation', () => {
  const desktopStore = useDesktopStore()
  const llmStore = useLlmStore()
  const secretsStore = useSecretsStore()
  const toast = useToastStore()
  /**
   * A client of the translation settings; `provider` overrides their provider,
   * e.g. for the dialog
   */
  const createClient = (provider: () => TranslationProvider | undefined) =>
    createTranslationClient({
      getConfig: () => {
        const config = normalizeTranslationConfig(
          desktopStore.userConfig?.translation
        )
        const override = provider()
        return override ? { ...config, provider: override } : config
      },
      getLlmLimits: () =>
        taskModelLimits(
          normalizeLlmConfig(desktopStore.userConfig?.llm),
          'translation'
        ),
      transport: createTauriTransport(tauriNetIpc),
      keys: createSecretKeyProvider(
        () => secretsStore.client.status(),
        translationKitSecretId
      ),
      runLlm: (prompt, signal, options = {}) =>
        llmStore.client.run('translation', prompt, { signal, ...options }),
    })
  const client = createClient(() => undefined)
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
