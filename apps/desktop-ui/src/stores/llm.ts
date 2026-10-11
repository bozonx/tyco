import { defineStore } from 'pinia'
import { ref } from 'vue'

import { createLlmClient, isKeylessProvider } from '../lib/llm/llm-client'
import { normalizeLlmConfig } from '../lib/llm/llm-config'
import {
  createSecretKeyProvider,
  createSecretsClient,
  type SecretsStatus,
  type SecretStorage,
} from '../lib/net/secrets'
import { createTauriTransport, tauriNetIpc } from '../lib/net/tauri-net'
import { useIpcStore } from './ipc'

export const useLlmStore = defineStore('llm', () => {
  const ipcStore = useIpcStore()
  const secretsClient = createSecretsClient(tauriNetIpc)
  /** Which provider keys exist; never the keys themselves */
  const secrets = ref<SecretsStatus>({})
  /** Where new keys go; null until known */
  const secretStorage = ref<SecretStorage | null>(null)

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
    // asked every time: a write the system store refuses sends new keys
    // into the file
    const [status, storage] = await Promise.all([
      secretsClient.status(),
      secretsClient.storage(),
    ])
    secrets.value = status
    secretStorage.value = storage
  }

  async function setSecret(id: string, value: string, origins?: string[]) {
    await secretsClient.set(id, value, origins)
    await refreshSecrets()
  }

  async function removeSecret(id: string) {
    await secretsClient.remove(id)
    await refreshSecrets()
  }

  return {
    client,
    secrets,
    secretStorage,
    refreshSecrets,
    setSecret,
    removeSecret,
  }
})
