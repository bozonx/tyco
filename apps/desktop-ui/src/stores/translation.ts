import { defineStore } from 'pinia'

import { normalizeTranslationConfig } from '../lib/translation/translation-config'
import { createTranslationClient } from '../lib/translation/translation-client'
import {
  createSecretKeyProvider,
  createSecretsClient,
} from '../lib/net/secrets'
import { createTauriTransport, tauriNetIpc } from '../lib/net/tauri-net'
import { useIpcStore } from './ipc'
import { useLlmStore } from './llm'

export const useTranslationStore = defineStore('translation', () => {
  const ipcStore = useIpcStore()
  const llmStore = useLlmStore()
  const secretsClient = createSecretsClient(tauriNetIpc)
  const client = createTranslationClient({
    getConfig: () =>
      normalizeTranslationConfig(ipcStore.params.userConfig?.translation),
    transport: createTauriTransport(tauriNetIpc),
    keys: createSecretKeyProvider(() => secretsClient.status()),
    runLlm: (prompt, signal) =>
      llmStore.client.run('translate', prompt, { signal }),
  })

  return { client }
})
