import { ref } from 'vue'

import type { SecretsStatus, VaultState } from './secrets'

export interface SecretsStateDependencies {
  status: () => Promise<SecretsStatus>
  vaultState: () => Promise<VaultState>
  set: (id: string, value: string, origins?: string[]) => Promise<void>
  remove: (id: string) => Promise<void>
}

/** Stores key availability, never credentials. The latest refresh wins. */
export function createSecretsState(deps: SecretsStateDependencies) {
  const secrets = ref<SecretsStatus>({})
  const vaultState = ref<VaultState | null>(null)
  let revision = 0

  const refreshSecrets = async () => {
    const request = ++revision
    const [status, state] = await Promise.all([
      deps.status(),
      deps.vaultState(),
    ])
    if (request !== revision) return
    secrets.value = status
    vaultState.value = state
  }

  const setSecret = async (id: string, value: string, origins?: string[]) => {
    await deps.set(id, value, origins)
    await refreshSecrets()
  }

  const removeSecret = async (id: string) => {
    await deps.remove(id)
    await refreshSecrets()
  }

  return { secrets, vaultState, refreshSecrets, setSecret, removeSecret }
}
