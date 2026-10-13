import { defineStore } from 'pinia'
import { markRaw } from 'vue'

import { normalizeTranslationConfig } from '../lib/translation/translation-config'
import { createTranslationClient } from '../lib/translation/translation-client'
import {
  createSecretKeyProvider,
  createSecretsClient,
} from '../lib/net/secrets'
import { createTauriTransport, tauriNetIpc } from '../lib/net/tauri-net'
import { useIpcStore } from './ipc'
import { useLlmStore } from './llm'
import { normalizeLlmConfig } from '../lib/llm/llm-config'
import { taskModelLimits } from '../lib/llm/llm-limits'

export const useTranslationStore = defineStore('translation', () => {
  const ipcStore = useIpcStore()
  const llmStore = useLlmStore()
  const secretsClient = createSecretsClient(tauriNetIpc)
  const client = createTranslationClient({
    getConfig: () =>
      normalizeTranslationConfig(ipcStore.desktopState.userConfig?.translation),
    getLlmLimits: () =>
      taskModelLimits(
        normalizeLlmConfig(ipcStore.desktopState.userConfig?.llm),
        'translate'
      ),
    transport: createTauriTransport(tauriNetIpc),
    keys: createSecretKeyProvider(() => secretsClient.status()),
    runLlm: (prompt, signal, options = {}) =>
      llmStore.client.run('translate', prompt, { signal, ...options }),
  })

  return { client: markRaw(client) }
})
