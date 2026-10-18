import { defineStore } from 'pinia'
import { markRaw } from 'vue'

import { createSecretsClient } from '../lib/net/secrets'
import { createSecretsState } from '../lib/net/secrets-state'
import { tauriNetIpc } from '../lib/net/tauri-net'

export const useSecretsStore = defineStore('secrets', () => {
  const client = createSecretsClient(tauriNetIpc)
  const state = createSecretsState(client)

  return { client: markRaw(client), ...state }
})
