import { defineStore } from 'pinia'
import { markRaw } from 'vue'

import { translate } from '../lib/i18n'
import { normalizeLlmConfig } from '../lib/llm/llm-config'
import { taskModelLimits } from '../lib/llm/llm-limits'
import { clientLogger } from '../lib/logger'
import { createSecretKeyProvider } from '../lib/net/secrets'
import { createTauriTransport, tauriNetIpc } from '../lib/net/tauri-net'
import { createTranslationActions } from '../lib/translation/translation-actions'
import { createTranslationClient } from '../lib/translation/translation-client'
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
  const client = createTranslationClient({
    getConfig: () =>
      normalizeTranslationConfig(desktopStore.userConfig?.translation),
    getLlmLimits: () =>
      taskModelLimits(
        normalizeLlmConfig(desktopStore.userConfig?.llm),
        'translate'
      ),
    transport: createTauriTransport(tauriNetIpc),
    keys: createSecretKeyProvider(() => secretsStore.client.status()),
    runLlm: (prompt, signal, options = {}) =>
      llmStore.client.run('translate', prompt, { signal, ...options }),
  })
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

  return { client: markRaw(client), actions: markRaw(actions) }
})
