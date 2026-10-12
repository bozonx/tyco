import { defineStore } from 'pinia'
import { markRaw } from 'vue'

import { createLlmClient, isKeylessProvider } from '../lib/llm/llm-client'
import { normalizeLlmConfig } from '../lib/llm/llm-config'
import {
  createSecretKeyProvider,
  createSecretsClient,
} from '../lib/net/secrets'
import { createTauriTransport, tauriNetIpc } from '../lib/net/tauri-net'
import { useIpcStore } from './ipc'
import { createSecretsState } from '../lib/net/secrets-state'

export const useLlmStore = defineStore('llm', () => {
  const ipcStore = useIpcStore()
  const secretsClient = createSecretsClient(tauriNetIpc)
  const state = createSecretsState(secretsClient)

  const getConfig = () => normalizeLlmConfig(ipcStore.params.userConfig?.llm)
  const client = createLlmClient({
    getConfig,
    transport: createTauriTransport(tauriNetIpc),
    keys: createSecretKeyProvider(
      () => secretsClient.status(),
      (provider) => isKeylessProvider(getConfig(), provider)
    ),
  })

  return { client: markRaw(client), ...state }
})
