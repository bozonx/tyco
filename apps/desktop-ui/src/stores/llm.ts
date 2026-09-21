import { defineStore } from 'pinia'
import { ref } from 'vue'

import { createLlmClient, isKeylessProvider } from '../lib/llm/llm-client'
import { normalizeLlmConfig } from '../lib/llm/llm-config'
import {
  createSecretKeyProvider,
  createSecretsClient,
  type SecretsStatus,
} from '../lib/net/secrets'
import { createTauriTransport, tauriNetIpc } from '../lib/net/tauri-net'
import { useIpcStore } from './ipc'

export const useLlmStore = defineStore('llm', () => {
  const ipcStore = useIpcStore()
  const secretsClient = createSecretsClient(tauriNetIpc)
  /** Which provider keys exist; never the keys themselves */
  const secrets = ref<SecretsStatus>({})

  const getConfig = () => normalizeLlmConfig(ipcStore.params.userConfig?.llm)
  const client = createLlmClient({
    getConfig,
    transport: createTauriTransport(tauriNetIpc),
    keys: createSecretKeyProvider(
      () => secretsClient.status(),
      (provider) => isKeylessProvider(getConfig(), provider)
    ),
  })

  async function refreshSecrets() {
    secrets.value = await secretsClient.status()
  }

  async function setSecret(id: string, value: string, origins?: string[]) {
    await secretsClient.set(id, value, origins)
    await refreshSecrets()
  }

  async function removeSecret(id: string) {
    await secretsClient.remove(id)
    await refreshSecrets()
  }

  return { client, secrets, refreshSecrets, setSecret, removeSecret }
})
