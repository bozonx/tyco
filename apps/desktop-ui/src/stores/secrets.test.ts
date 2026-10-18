import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SecretsClient } from '../lib/net/secrets'
import { useSecretsStore } from './secrets'

const mocks = vi.hoisted(() => ({
  status: vi.fn(async () => ({
    openai: { origins: ['https://api.openai.com'], available: true },
  })),
  vaultState: vi.fn(async () => 'available' as const),
  set: vi.fn(async () => {}),
  remove: vi.fn(async () => {}),
}))

vi.mock(import('../lib/net/secrets'), async (importOriginal) => ({
  ...(await importOriginal()),
  createSecretsClient: (): SecretsClient => mocks,
}))

afterEach(() => vi.clearAllMocks())

describe('useSecretsStore', () => {
  it('refreshes and mutates secrets state through its client', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    try {
      const store = useSecretsStore()
      await store.refreshSecrets()

      expect(store.vaultState).toBe('available')
      expect(store.secrets).toEqual({
        openai: { origins: ['https://api.openai.com'], available: true },
      })

      await store.setSecret('deepl', 'key-123')
      expect(mocks.set).toHaveBeenCalledWith('deepl', 'key-123', undefined)

      await store.removeSecret('deepl')
      expect(mocks.remove).toHaveBeenCalledWith('deepl')
    } finally {
      disposePinia(pinia)
    }
  })

  it('isolates state across Pinia instances', () => {
    const first = createPinia()
    const second = createPinia()
    try {
      const firstStore = useSecretsStore(first)
      const secondStore = useSecretsStore(second)
      firstStore.vaultState = 'unavailable'

      expect(secondStore.vaultState).toBeNull()
    } finally {
      disposePinia(first)
      disposePinia(second)
    }
  })
})
