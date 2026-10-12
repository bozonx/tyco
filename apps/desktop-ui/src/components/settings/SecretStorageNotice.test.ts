import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import type { SecretsStatus, VaultState } from '../../lib/net/secrets'
import SecretStorageNotice from './SecretStorageNotice.vue'

const store = vi.hoisted(() => ({
  vaultState: null as VaultState | null,
  secrets: {} as SecretsStatus,
}))

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('../../stores/llm', () => ({ useLlmStore: () => store }))

const origins = ['https://api.openai.com']

describe('SecretStorageNotice.vue', () => {
  it('warns when the keychain is unavailable', () => {
    store.vaultState = 'unavailable'
    store.secrets = {}
    const wrapper = mount(SecretStorageNotice)

    expect(wrapper.text()).toContain('settings.secretStorageUnavailable')
  })

  it('warns when a stored key cannot be read', () => {
    store.vaultState = 'available'
    store.secrets = { openai: { origins, available: false } }
    const wrapper = mount(SecretStorageNotice)

    expect(wrapper.text()).toContain('settings.secretStorageUnavailable')
  })

  it.each(['available', null] as const)(
    'stays hidden for the keychain state %s',
    (state) => {
      store.vaultState = state
      store.secrets = { openai: { origins, available: true } }
      const wrapper = mount(SecretStorageNotice)

      expect(wrapper.text()).toBe('')
    }
  )
})
