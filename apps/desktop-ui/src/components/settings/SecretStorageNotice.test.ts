import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import SecretStorageNotice from './SecretStorageNotice.vue'

const store = vi.hoisted(() => ({
  secretStorage: null as 'system' | 'file' | null,
}))

vi.mock('../../composables/useI18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('../../stores/llm', () => ({ useLlmStore: () => store }))

describe('SecretStorageNotice.vue', () => {
  it('warns when keys are kept in a file', () => {
    store.secretStorage = 'file'
    const wrapper = mount(SecretStorageNotice)

    expect(wrapper.text()).toContain('settings.secretStorageFile')
  })

  it.each(['system', null] as const)(
    'stays hidden for the storage %s',
    (storage) => {
      store.secretStorage = storage
      const wrapper = mount(SecretStorageNotice)

      expect(wrapper.text()).toBe('')
    }
  )
})
